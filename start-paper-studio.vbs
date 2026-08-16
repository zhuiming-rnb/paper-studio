' Paper Studio - hidden launcher (no console window, no flash)
' Probe uses netstat (local, no HTTP) to avoid MSXML hangs.
Option Explicit

Dim ws, fso, dir, tmp, siteUrl, up, i
Set ws = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = "E:\workplace\paper-studio"
siteUrl = "http://127.0.0.1:3000/"
tmp = ws.ExpandEnvironmentStrings("%TEMP%") & "\paper-studio-probe.txt"

Function IsServerUp()
  ws.Run "cmd /c netstat -ano -p TCP | findstr ""LISTENING"" | findstr "":3000"" > """ & tmp & """ 2>nul", 0, True
  If fso.FileExists(tmp) Then
    Dim f, content
    Set f = fso.OpenTextFile(tmp, 1, False, 0)
    If f.AtEndOfStream Then
      content = ""
    Else
      content = f.ReadAll
    End If
    f.Close
    fso.DeleteFile tmp, True
    If content <> "" And InStr(content, ":3000") > 0 Then
      IsServerUp = True
      Exit Function
    End If
  End If
  IsServerUp = False
End Function

' Already running? Just open the site.
If IsServerUp() Then
  ws.Run siteUrl, 1, False
  WScript.Quit 0
End If

' Start the server fully hidden (window style 0 = invisible).
ws.Run "cmd.exe /c ""cd /d " & dir & " && npm start""", 0, False

' Wait up to 30s for the server, then open the site.
For i = 0 To 29
  WScript.Sleep 1000
  If IsServerUp() Then
    ws.Run siteUrl, 1, False
    WScript.Quit 0
  End If
Next

WScript.Quit 1
