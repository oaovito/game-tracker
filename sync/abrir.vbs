' abrir.vbs - o que o atalho da area de trabalho executa.
'
' Tres coisas, nesta ordem, e nenhuma delas mostra janela:
'
'   1. garante que o servico esta de pe. Ele sobe no logon, mas pode ter sido
'      encerrado a mao, e um atalho que abre uma aba de erro nao e um atalho.
'   2. avisa o servico de que a aplicacao foi aberta, para a chama acender na
'      bandeja. Pelo atalho a abertura e livre e deliberada, entao ela aparece
'      -- ao contrario da abertura automatica, que so acontece com o jogo.
'   3. abre a pagina no navegador padrao.
'
' Em VBScript e nao em PowerShell porque o wscript nao mostra console nenhum,
' e um atalho que pisca uma janela preta antes de abrir o navegador parece
' defeito. E o wscript.exe ja vem no Windows, como o resto do que este projeto
' usa -- nada para baixar.

Option Explicit

Dim fso, shell, raiz, porta, url
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

raiz = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
porta = 8777
url = "http://localhost:" & porta & "/"

' Abrir a mao desfaz o "Fechar" da bandeja: sem a marca, o servico volta a
' subir sozinho no logon e com o jogo.
If fso.FileExists(fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "fechado.flag")) Then
  fso.DeleteFile fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "fechado.flag"), True
End If

' --- 1. o servico esta no ar? ---
Dim http, vivo
vivo = False
On Error Resume Next
Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
http.setTimeouts 1000, 1000, 2000, 2000
http.open "GET", url & "progress.json", False
http.send
If Err.Number = 0 And http.status = 200 Then vivo = True
Err.Clear
On Error GoTo 0

If Not vivo Then
  ' A tarefa agendada e o caminho certo para subir: ela roda como o usuario
  ' certo e com o diretorio certo. Chamar o node daqui subiria um processo
  ' orfao que nao sobrevive ao logoff.
  shell.Run "schtasks /run /tn TrackeroaoSync", 0, True

  ' Espera ate cinco segundos pelo servidor. Abrir o navegador antes de ele
  ' responder daria a pagina de erro do navegador, que e pior que esperar.
  Dim tentativa
  For tentativa = 1 To 10
    WScript.Sleep 500
    On Error Resume Next
    Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
    http.setTimeouts 1000, 1000, 2000, 2000
    http.open "GET", url & "progress.json", False
    http.send
    If Err.Number = 0 And http.status = 200 Then
      vivo = True
      Err.Clear
      On Error GoTo 0
      Exit For
    End If
    Err.Clear
    On Error GoTo 0
  Next
End If

' --- 2. acende a bandeja ---
' Sem parar por causa disto: o icone e sinal, e a pagina e o que a pessoa
' pediu. Falhar aqui nao pode impedir o passo 3.
If vivo Then
  On Error Resume Next
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  http.setTimeouts 1000, 1000, 2000, 2000
  http.open "GET", url & "abrir", False
  http.send
  Err.Clear
  On Error GoTo 0
End If

' --- 3. a pagina ---
shell.Run url, 1, False
