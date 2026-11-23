Set sh = CreateObject("WScript.Shell")
d = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = d
sh.Run "cmd /c npm start", 0, False
MsgBox "Bot Meridian berjalan di belakang tabir. Guna HENTI-BOT untuk hentikan.", 64, "Meridian"
