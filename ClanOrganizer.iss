; Inno Setup recipe: makes ClanOrganizer-Setup.exe (installer + automatic uninstaller).
; Installs per user (no admin password needed) and shows up in Windows Settings > Apps > Installed apps.
#define AppName "Clan Organizer"
#define AppVersion "1.0"

[Setup]
AppId={{6F1C2E58-5B7A-4D0E-9C3B-2A41C0DE0001}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Arowosaye
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
PrivilegesRequired=lowest
OutputDir=installer
OutputBaseFilename=ClanOrganizer-Setup
SetupIconFile=static\assets\clan-organizer.ico
UninstallDisplayIcon={app}\ClanOrganizer.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"

[Files]
Source: "dist\ClanOrganizer\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\ClanOrganizer.exe"
Name: "{autoprograms}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\ClanOrganizer.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\ClanOrganizer.exe"; Description: "Start {#AppName}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; make sure the app and its background server are closed before files are removed
Filename: "{sys}\taskkill.exe"; Parameters: "/F /T /IM ClanOrganizer.exe"; Flags: runhidden; RunOnceId: "KillApp"

[Code]
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    DataDir := ExpandConstant('{localappdata}\Clan Organizer');
    if DirExists(DataDir) then
      if MsgBox('Also delete your saved clans, history and API key?' + #13#10 + #13#10 +
                'Choose No if you plan to install Clan Organizer again and keep your history.',
                mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
        DelTree(DataDir, True, True, True);
  end;
end;
