' Запуск приложения (для отладки; ярлык запускает electron.exe напрямую)
Option Explicit

Dim fso, appDir, electronExe, shell

Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
electronExe = appDir & "\node_modules\electron\dist\electron.exe"

If Not fso.FileExists(electronExe) Then
  MsgBox "Установите зависимости:" & vbCrLf & vbCrLf & "cd " & appDir & vbCrLf & "npm install", vbCritical, "Караоке"
  WScript.Quit 1
End If

Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = appDir
shell.Run """" & electronExe & """ .", 1, False
