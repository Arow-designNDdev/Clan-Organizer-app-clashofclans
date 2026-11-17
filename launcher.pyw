"""Clan Organizer launcher: double-click (via "Clan Organizer.bat") to start the app, open the browser and share it.
Run with --selftest to check the non-window parts without opening anything."""
import json
import os
import queue
import re
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

FROZEN = bool(getattr(sys, "frozen", False))                 # True when running as the installed .exe
HERE = Path(getattr(sys, "_MEIPASS", None) or Path(__file__).resolve().parent)   # bundled, read-only files (icons, static/)
IS_WIN = os.name == "nt"
# Where the user's own files go (key, clan history, sharing tool). Installed apps cannot write next to the .exe, so use AppData.
USER_DIR = (Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "Clan Organizer") if FROZEN else HERE
USER_DIR.mkdir(parents=True, exist_ok=True)
NOWIN = 0x08000000 if IS_WIN else 0          # no black console windows
PORT = 5000
TUNNEL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")
CF_URL = {"nt": "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe",
          "posix": "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"}


# ----------------------------------------------------------------------------- helpers
def config():
    try:
        return json.loads((USER_DIR / "config.json").read_text(encoding="utf-8"))
    except Exception:
        return {}


def has_key():
    k = (config().get("api_key") or os.environ.get("COC_API_KEY") or "").strip()
    return bool(k) and "PASTE" not in k.upper()


def save_key(key, folder=USER_DIR):
    cfg = {"api_key": key.strip(), "clan_tag": "", "base_url": "https://cocproxy.royaleapi.dev/v1", "sync_minutes": 60, "games_max": 4000}
    old = {}
    try:
        old = json.loads((folder / "config.json").read_text(encoding="utf-8"))
    except Exception:
        pass
    cfg = {**old, **cfg}
    (folder / "config.json").write_text(json.dumps(cfg, indent=2), encoding="utf-8")


def have_deps():
    if FROZEN:
        return True
    try:
        import flask, requests  # noqa
        return True
    except ImportError:
        return False


def install_deps():
    r = subprocess.run([sys.executable, "-m", "pip", "install", "-r", str(HERE / "requirements.txt")],
                       capture_output=True, text=True, creationflags=NOWIN)
    return r.returncode == 0, (r.stderr or r.stdout)[-400:]


def healthy(port, timeout=1.0):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/healthz", timeout=timeout) as r:
            return r.read().strip() == b"ok"
    except Exception:
        return False


def port_free(port):
    with socket.socket() as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) != 0


def kill_tree(proc):
    if not proc or proc.poll() is not None:
        return
    try:
        if IS_WIN:
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True, creationflags=NOWIN)
        else:
            proc.terminate()
            proc.wait(5)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


# ----------------------------------------------------------------------------- server + tunnel
class Server:
    def __init__(self, data_dir=None):
        self.proc, self.port, self.external, self.data_dir = None, PORT, False, data_dir

    def start(self, password=""):
        if healthy(PORT) and not self.proc:           # already running from an earlier launch
            self.port, self.external = PORT, True
            return
        self.port = PORT
        while not port_free(self.port):
            self.port += 1
        env = os.environ.copy()
        env.update(HOST="127.0.0.1", PORT=str(self.port), PYTHONUNBUFFERED="1")
        env["DATA_DIR"] = str(self.data_dir or USER_DIR / "data")
        env["CONFIG_FILE"] = str(USER_DIR / "config.json")
        if password:
            env.update(ADMIN_PASSWORD=password, SYNC_COOLDOWN="300")
        else:
            env.pop("ADMIN_PASSWORD", None)
        (USER_DIR / "data").mkdir(exist_ok=True)
        log = open(USER_DIR / "data" / "launcher.log", "a", encoding="utf-8")
        cmd = [sys.executable, "--server"] if FROZEN else [sys.executable, str(HERE / "app.py")]
        self.proc = subprocess.Popen(cmd, cwd=str(USER_DIR), env=env, stdout=log, stderr=subprocess.STDOUT,
                                     stdin=subprocess.DEVNULL, creationflags=NOWIN)
        self.external = False

    def wait_ready(self, timeout=45):
        t0 = time.time()
        while time.time() - t0 < timeout:
            if self.proc and self.proc.poll() is not None:
                return False
            if healthy(self.port):
                return True
            time.sleep(0.4)
        return False

    def stop(self):
        if not self.external:
            kill_tree(self.proc)
        self.proc = None

    @property
    def url(self):
        return f"http://localhost:{self.port}/"


class Tunnel:
    def __init__(self):
        self.proc = None

    def binary(self):
        found = shutil.which("cloudflared")
        if found:
            return found
        local = USER_DIR / "tools" / ("cloudflared.exe" if IS_WIN else "cloudflared")
        return str(local) if local.exists() else None

    def download(self):
        url = CF_URL.get(os.name)
        if not url or sys.platform == "darwin":
            raise RuntimeError("On a Mac, install the sharing tool once with: brew install cloudflared")
        dest = USER_DIR / "tools" / ("cloudflared.exe" if IS_WIN else "cloudflared")
        dest.parent.mkdir(exist_ok=True)
        urllib.request.urlretrieve(url, dest)
        if not IS_WIN:
            dest.chmod(0o755)
        return str(dest)

    def start(self, port, timeout=45):
        exe = self.binary() or self.download()
        self.proc = subprocess.Popen([exe, "tunnel", "--url", f"http://127.0.0.1:{port}", "--no-autoupdate"], stdout=subprocess.PIPE,
                                     stderr=subprocess.STDOUT, text=True, creationflags=NOWIN)
        found = queue.Queue()

        def reader():
            for line in self.proc.stdout:
                m = TUNNEL_RE.search(line)
                if m:
                    found.put(m.group(0))

        threading.Thread(target=reader, daemon=True).start()
        try:
            return found.get(timeout=timeout)
        except queue.Empty:
            self.stop()
            raise RuntimeError("The sharing link did not start. Check your internet and try again.")

    def stop(self):
        kill_tree(self.proc)
        self.proc = None


def selftest():
    import tempfile
    ok = True
    tmp = Path(tempfile.mkdtemp())
    save_key("abc123", tmp)
    cfg = json.loads((tmp / "config.json").read_text())
    print("config written:", cfg["api_key"] == "abc123" and "royaleapi" in cfg["base_url"]); ok &= cfg["api_key"] == "abc123"
    m = TUNNEL_RE.search("2026 INF |  https://rapid-green-fox-12.trycloudflare.com  |")
    print("tunnel url parsed:", m.group(0) if m else None); ok &= bool(m)
    print("deps present:", have_deps())
    s = Server(data_dir=tmp)
    s.start(password="pw")
    ready = s.wait_ready(30)
    print("server started:", ready, "port", s.port)
    if ready:
        with urllib.request.urlopen(f"http://127.0.0.1:{s.port}/api/clans", timeout=3) as r:
            body = json.loads(r.read())
        print("api answers:", "clans" in body, "| password protection on:", body.get("auth"))
        ok &= "clans" in body and body.get("auth") is True
    s.stop()
    time.sleep(0.5)
    print("server stopped:", not healthy(s.port))
    ok &= ready
    print("SELFTEST", "PASSED" if ok else "FAILED")
    return 0 if ok else 1


# ----------------------------------------------------------------------------- window
def run_gui(test_seconds=0):
    import tkinter as tk
    from tkinter import ttk, messagebox

    BG, PANEL, GOLD, INK, DIM = "#211b12", "#2c2418", "#f0b646", "#f6efe0", "#a99c84"
    try:
        import ctypes
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        pass

    class Launcher(tk.Tk):
        def __init__(self):
            super().__init__()
            self.title("Clan Organizer")
            self.configure(bg=BG)
            self.geometry("560x560")
            self.minsize(520, 520)
            ico = HERE / "static" / "assets" / "clan-organizer.ico"
            try:
                if IS_WIN and ico.exists():
                    self.iconbitmap(str(ico))
                else:
                    self.iconphoto(True, tk.PhotoImage(file=str(HERE / "static" / "assets" / "logo-crown.png")).subsample(5))
            except Exception:
                pass
            self.q, self.server, self.tunnel, self.sharing, self.password, self.busy = queue.Queue(), Server(), Tunnel(), False, "", False
            self.protocol("WM_DELETE_WINDOW", self.quit_all)
            self.build()
            self.after(100, self.pump)
            self.after(200, lambda: threading.Thread(target=self.boot, daemon=True).start())
            if test_seconds:
                self.after(int((test_seconds - 1.5) * 1000), self.report)
                self.after(int(test_seconds * 1000), self.quit_all)

        # ---- ui
        def build(self):
            top = tk.Frame(self, bg=BG)
            top.pack(pady=(22, 6))
            try:
                self.logo = tk.PhotoImage(file=str(HERE / "static" / "assets" / "logo-crown.png")).subsample(5)
                tk.Label(top, image=self.logo, bg=BG).pack(side="left", padx=(0, 12))
            except Exception:
                pass
            tk.Label(top, text="Clan Organizer", bg=BG, fg=INK, font=("Georgia", 26, "bold")).pack(side="left")
            row = tk.Frame(self, bg=BG)
            row.pack(pady=(4, 10))
            self.dot = tk.Canvas(row, width=16, height=16, bg=BG, highlightthickness=0)
            self.dot.pack(side="left", padx=(0, 8))
            self.dot_id = self.dot.create_oval(2, 2, 14, 14, fill=DIM, outline="")
            self.status = tk.Label(row, text="Starting...", bg=BG, fg=INK, font=("Segoe UI", 11))
            self.status.pack(side="left")
            self.setup = tk.Frame(self, bg=PANEL, padx=18, pady=14)
            tk.Label(self.setup, text="One-time setup", bg=PANEL, fg=GOLD, font=("Georgia", 14, "bold")).pack(anchor="w")
            tk.Label(self.setup, justify="left", wraplength=470, bg=PANEL, fg=INK, font=("Segoe UI", 10),
                     text="1. Open developer.clashofclans.com and create a key.\n2. When it asks for an IP address, enter 45.79.218.79\n3. Paste the key below and press Save.").pack(anchor="w", pady=(6, 8))
            self.key = tk.Entry(self.setup, width=54, bg="#17120b", fg=INK, insertbackground=INK, relief="flat", font=("Consolas", 10))
            self.key.pack(fill="x", ipady=6)
            br = tk.Frame(self.setup, bg=PANEL)
            br.pack(fill="x", pady=(10, 0))
            self.button(br, "Open that website", lambda: webbrowser.open("https://developer.clashofclans.com"), ghost=True).pack(side="left")
            self.button(br, "Save and start", self.save_and_start).pack(side="right")
            self.main = tk.Frame(self, bg=BG)
            self.open_btn = self.button(self.main, "Open Clan Organizer", lambda: webbrowser.open(self.server.url), big=True)
            self.open_btn.pack(fill="x", pady=(0, 10))
            self.share_btn = self.button(self.main, "Share with a friend", self.toggle_share, ghost=True)
            self.share_btn.pack(fill="x", pady=(0, 10))
            self.share = tk.Frame(self.main, bg=PANEL, padx=16, pady=12)
            tk.Label(self.share, text="Send your friend this link", bg=PANEL, fg=GOLD, font=("Georgia", 12, "bold")).pack(anchor="w")
            self.link = self.copy_row(self.share)
            tk.Label(self.share, text="and this password", bg=PANEL, fg=GOLD, font=("Georgia", 12, "bold")).pack(anchor="w", pady=(10, 0))
            self.pw = self.copy_row(self.share)
            tk.Label(self.share, justify="left", wraplength=470, bg=PANEL, fg=DIM, font=("Segoe UI", 9),
                     text="They open the link, add their clan and enter the password when asked. The link only works while this window is open and your computer is on.").pack(anchor="w", pady=(10, 0))
            self.note = tk.Label(self, text="", bg=BG, fg=DIM, font=("Segoe UI", 9), wraplength=500)
            self.note.pack(side="bottom", pady=10)
            self.button(self, "Stop and close", self.quit_all, ghost=True).pack(side="bottom", pady=(0, 4))

        def button(self, parent, text, cmd, ghost=False, big=False):
            b = tk.Button(parent, text=text, command=cmd, relief="flat", cursor="hand2", bd=0, padx=18, pady=12 if big else 8,
                          bg=BG if ghost else GOLD, fg=GOLD if ghost else "#2a1c08", activebackground="#3a2d17" if ghost else "#ffd27a",
                          font=("Georgia", 13 if big else 11, "bold"), highlightthickness=1, highlightbackground=GOLD)
            return b

        def copy_row(self, parent):
            f = tk.Frame(parent, bg=PANEL)
            f.pack(fill="x", pady=(4, 0))
            e = tk.Entry(f, bg="#17120b", fg=INK, readonlybackground="#17120b", relief="flat", font=("Consolas", 10), state="readonly")
            e.pack(side="left", fill="x", expand=True, ipady=6)
            self.button(f, "Copy", lambda: (self.clipboard_clear(), self.clipboard_append(e.get()), self.set_note("Copied"))).pack(side="right", padx=(8, 0))
            return e

        def fill(self, entry, text):
            entry.config(state="normal")
            entry.delete(0, "end")
            entry.insert(0, text)
            entry.config(state="readonly")

        def set_status(self, text, color=DIM):
            self.status.config(text=text)
            self.dot.itemconfig(self.dot_id, fill=color)

        def set_note(self, text):
            self.note.config(text=text)

        def pump(self):
            try:
                while True:
                    self.q.get_nowait()()
            except queue.Empty:
                pass
            self.after(120, self.pump)

        def ui(self, fn):
            self.q.put(fn)

        # ---- logic
        def boot(self):
            if not have_deps():
                self.ui(lambda: self.set_status("First run: installing what the app needs (about a minute)...", GOLD))
                ok, err = install_deps()
                if not ok:
                    self.ui(lambda: (self.set_status("Install failed", "#e5544d"), self.set_note(err)))
                    return
            if not has_key():
                self.ui(lambda: (self.set_status("Waiting for your API key", GOLD), self.setup.pack(fill="x", padx=24, pady=8)))
                return
            self.start_server()

        def save_and_start(self):
            key = self.key.get().strip()
            if len(key) < 20:
                messagebox.showinfo("Clan Organizer", "That key looks too short. Paste the whole key from developer.clashofclans.com.")
                return
            save_key(key)
            self.setup.pack_forget()
            threading.Thread(target=self.start_server, daemon=True).start()

        def start_server(self, password="", open_browser=True):
            self.ui(lambda: self.set_status("Starting...", GOLD))
            self.server.start(password)
            if not self.server.wait_ready():
                self.ui(lambda: (self.set_status("Could not start", "#e5544d"), self.set_note("Look at the data folder in %LOCALAPPDATA%\\Clan Organizer (launcher.log) for the reason.")))
                return False
            self.ui(lambda: (self.set_status(("Running at " + self.server.url) + (" (already open from before)" if self.server.external else ""), "#46c46b"), self.main.pack(fill="x", padx=24, pady=8)))
            if open_browser and not os.environ.get("NO_BROWSER"):
                webbrowser.open(self.server.url)
            return True

        def toggle_share(self):
            if self.busy:
                return
            self.busy = True
            threading.Thread(target=self.do_share, daemon=True).start()

        def do_share(self):
            try:
                if self.sharing:
                    self.tunnel.stop()
                    self.server.stop()
                    self.sharing = False
                    self.start_server(open_browser=False)
                    self.ui(lambda: (self.share.pack_forget(), self.share_btn.config(text="Share with a friend"), self.set_note("Sharing stopped.")))
                    return
                if self.server.external:
                    self.ui(lambda: self.set_note("Close the other Clan Organizer window first, then try again."))
                    return
                if not self.tunnel.binary():
                    self.ui(lambda: self.set_status("Downloading the sharing tool (one time, about 30 MB)...", GOLD))
                    self.tunnel.download()
                self.password = secrets.token_urlsafe(6)
                self.ui(lambda: self.set_status("Setting up sharing...", GOLD))
                self.server.stop()
                if not self.start_server(self.password, open_browser=False):
                    return
                url = self.tunnel.start(self.server.port)
                self.sharing = True
                self.ui(lambda: (self.fill(self.link, url), self.fill(self.pw, self.password), self.share.pack(fill="x", pady=(0, 6)),
                                 self.share_btn.config(text="Stop sharing"), self.set_status("Sharing is on", "#46c46b"),
                                 self.set_note("The browser will ask for the password the first time you add a clan too.")))
            except Exception as e:
                self.ui(lambda: (self.set_status("Sharing failed", "#e5544d"), self.set_note(str(e))))
            finally:
                self.busy = False

        def report(self):  # used by --gui-test only
            self.update_idletasks()
            print("STATUS:", self.status.cget("text"), "| open button shown:", bool(self.open_btn.winfo_ismapped()), "| setup box shown:", bool(self.setup.winfo_ismapped()), flush=True)
            try:
                from PIL import ImageGrab
                ImageGrab.grab(xdisplay=os.environ.get("DISPLAY")).crop((self.winfo_rootx(), self.winfo_rooty(), self.winfo_rootx() + self.winfo_width(), self.winfo_rooty() + self.winfo_height())).save(os.environ.get("SHOT", "/tmp/cv/launcher.png"))
                print("screenshot saved", flush=True)
            except Exception as e:
                print("screenshot skipped:", e, flush=True)

        def quit_all(self):
            try:
                self.tunnel.stop()
                self.server.stop()
            finally:
                self.destroy()

    Launcher().mainloop()


def run_server_mode():
    """Installed .exe starts itself with --server to run the web app in a second, hidden process."""
    import io
    for name in ("stdout", "stderr"):                 # windowed exes have no console; keep print() from crashing
        if getattr(sys, name) is None:
            setattr(sys, name, io.StringIO())
    sys.path.insert(0, str(HERE))
    import app
    app.main()


if __name__ == "__main__":
    if "--server" in sys.argv:
        run_server_mode()
        sys.exit(0)
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    run_gui(test_seconds=float(sys.argv[sys.argv.index("--gui-test") + 1]) if "--gui-test" in sys.argv else 0)
