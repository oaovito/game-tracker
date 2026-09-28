' Sobe o servico sem janela nenhuma.
'
' node.exe abre um console proprio, e -WindowStyle da tarefa agendada nao se
' aplica a ele: quem decide e o processo, nao quem o chama. Antes isso era
' resolvido por um utilitario de terceiro que morava numa pasta irma, fora do
' projeto — o que quebrava a ideia de clonar o repositorio e rodar, porque a
' dependencia nao vinha junto. O wscript.exe ja vem no Windows e faz a
' mesma coisa: Run com o segundo argumento 0 significa janela oculta, e o
' terceiro False significa nao esperar o processo terminar, entao a tarefa
' agendada conclui na hora e o servico fica de pe.
'
' Recebe os caminhos por argumento para nao ter nada fixo aqui dentro:
'   wscript oculto.vbs "<caminho do node.exe>" "<caminho do main.js>"

Option Explicit

Dim shell, node, script, comando
Set shell = CreateObject("WScript.Shell")

If WScript.Arguments.Count < 2 Then
    WScript.Echo "uso: wscript oculto.vbs <node.exe> <main.js>"
    WScript.Quit 1
End If

node = WScript.Arguments(0)
script = WScript.Arguments(1)

comando = """" & node & """ """ & script & """"
shell.Run comando, 0, False
