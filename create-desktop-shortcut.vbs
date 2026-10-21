Option Explicit
Dim fso, appDir, shell
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = appDir
shell.Run "node """ & appDir & "\create-desktop-shortcut.js""", 0, True
MsgBox "Готово. Проверьте ярлык «Караоке» на рабочем столе.", vbInformation, "Караоке"
