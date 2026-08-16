' Paper Studio - hidden launcher (no console window, no flash)
' Run by wscript (GUI host, never shows a console).
Option Explicit

Dim ws, dir, port, siteUrl, probeUrl, running, i
Set ws = CreateObject("WScript.Shell")
dir = "E:\workplace\paper-studio"
port = 3000
siteUrl = "http://127.0.0.1:" & port & "/"
probeUrl = "http://127.0.0.1:" & port & "/api/papers"

Function IsServerUp()
  On Error Resume Next
  Dim http
  Set http = CreateObject("MSXML2.XMLHTTP")
  http.open "GET", probeUrl, False
  http.setRequestHeader "User-Agent", "paper-studio-launcher"
  http.setTimeouts 1500, 1500, 1500, 1500
  http.send ""
  If Err.Number = 0 And http.status = 200 Then
    IsServerUp = True
  Else
    IsServerUp = False
  End If
  Err.Clear
  On Error GoTo 0
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
