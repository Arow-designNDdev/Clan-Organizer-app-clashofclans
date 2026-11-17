# PyInstaller recipe: turns the app into a folder with ClanOrganizer.exe (no Python needed on the target PC).
# Build with build_installer.bat (Windows). Output: dist\ClanOrganizer\
a = Analysis(
    ['launcher.pyw'],
    pathex=['.'],
    datas=[('static', 'static')],
    hiddenimports=['app', 'flask', 'requests', 'waitress', 'sqlite3', 'tkinter'],
    excludes=['PIL', 'numpy', 'pandas', 'matplotlib'],
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name='ClanOrganizer',
    console=False,                                   # no black window
    icon='static/assets/clan-organizer.ico',
)
coll = COLLECT(exe, a.binaries, a.datas, name='ClanOrganizer')
