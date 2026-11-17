$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Clan Organizer.lnk'))
$lnk.TargetPath = Join-Path $here 'Clan Organizer.bat'
$lnk.WorkingDirectory = $here
$lnk.IconLocation = Join-Path $here 'static\assets\clan-organizer.ico'
$lnk.WindowStyle = 7
$lnk.Description = 'Clan Organizer'
$lnk.Save()
