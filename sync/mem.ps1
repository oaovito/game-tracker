# mem.ps1 - leitura de memoria do processo do jogo, somente leitura.
#
# O Node nao consegue chamar ReadProcessMemory sozinho, e este projeto nao tem
# dependencia nativa nenhuma - nem vai ter. O PowerShell ja e usado aqui (a
# tarefa agendada, o instalador), e com Add-Type ele compila o P/Invoke na hora.
# Entao a ponte e esta: o Node manda um pedido em JSON pela entrada padrao e
# recebe a resposta em JSON pela saida.
#
# SOMENTE LEITURA, e isso nao e retorica: o handle e aberto com
# PROCESS_VM_READ | PROCESS_QUERY_INFORMATION. Sem PROCESS_VM_WRITE, sem
# PROCESS_VM_OPERATION. Uma tentativa de escrita falharia no nivel do Windows,
# nao na boa vontade deste script. O mesmo principio do leitor de save: este
# programa observa o jogo, nunca mexe nele.

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class Mem {
    // Sem VM_WRITE e sem VM_OPERATION: este handle nao consegue escrever.
    const int PROCESS_VM_READ = 0x0010;
    const int PROCESS_QUERY_INFORMATION = 0x0400;

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(int access, bool inherit, int pid);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, int size, out IntPtr read);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr h);

    static IntPtr handle = IntPtr.Zero;
    static Process proc = null;

    public static bool Open(string name) {
        Process[] all = Process.GetProcessesByName(name);
        if (all.Length == 0) return false;
        proc = all[0];
        handle = OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, false, proc.Id);
        return handle != IntPtr.Zero;
    }

    public static int Pid() { return proc == null ? 0 : proc.Id; }

    public static long ModuleBase() {
        if (proc == null) return 0;
        return (long)proc.MainModule.BaseAddress;
    }

    public static long ModuleSize() {
        if (proc == null) return 0;
        return proc.MainModule.ModuleMemorySize;
    }

    public static byte[] Read(long addr, int size) {
        byte[] buf = new byte[size];
        IntPtr lidos;
        if (!ReadProcessMemory(handle, (IntPtr)addr, buf, size, out lidos)) return null;
        if ((long)lidos != size) return null;
        return buf;
    }

    // Varredura por padrao de bytes com curinga. `mask` traz 'x' para byte
    // exigido e '?' para qualquer um. Le em blocos grandes com sobreposicao do
    // tamanho do padrao, senao um casamento partido entre blocos escaparia.
    public static long Scan(long inicio, long tamanho, byte[] padrao, string mask) {
        int n = padrao.Length;
        int bloco = 0x100000;
        byte[] buf = new byte[bloco];
        long pos = inicio;
        long fim = inicio + tamanho;
        while (pos < fim) {
            int ler = (int)Math.Min((long)bloco, fim - pos);
            IntPtr lidos;
            if (!ReadProcessMemory(handle, (IntPtr)pos, buf, ler, out lidos) || (long)lidos <= 0) {
                pos += bloco; continue;
            }
            int validos = (int)lidos;
            for (int i = 0; i + n <= validos; i++) {
                bool bate = true;
                for (int j = 0; j < n; j++) {
                    if (mask[j] == 'x' && buf[i + j] != padrao[j]) { bate = false; break; }
                }
                if (bate) return pos + i;
            }
            pos += Math.Max(1, validos - n);
        }
        return 0;
    }

    public static void Close() {
        if (handle != IntPtr.Zero) { CloseHandle(handle); handle = IntPtr.Zero; }
    }
}
'@

function Hex([long]$v) { return '0x' + $v.ToString('x') }

# Converte "48 8B 35 ? ? ? ?" em bytes + mascara.
function ParsePadrao([string]$p) {
    $tok = $p.Trim() -split '\s+'
    $bytes = New-Object byte[] $tok.Length
    $mask = ''
    for ($i = 0; $i -lt $tok.Length; $i++) {
        if ($tok[$i] -eq '?' -or $tok[$i] -eq '??') { $bytes[$i] = 0; $mask += '?' }
        else { $bytes[$i] = [Convert]::ToByte($tok[$i], 16); $mask += 'x' }
    }
    return @{ bytes = $bytes; mask = $mask }
}

$entrada = [Console]::In.ReadToEnd()
$req = $entrada | ConvertFrom-Json
$out = @{ ok = $false }

try {
    if (-not [Mem]::Open($req.processo)) {
        $out.erro = 'processo nao encontrado ou sem permissao de leitura'
    } else {
        $base = [Mem]::ModuleBase()
        $size = [Mem]::ModuleSize()
        $out.pid = [Mem]::Pid()
        $out.base = $base
        $out.tamanho = $size
        $out.ok = $true
        $res = @{}

        foreach ($op in $req.ops) {
            if ($op.tipo -eq 'scanRel') {
                # Acha o padrao, le o deslocamento relativo de 4 bytes em
                # `desloc` e soma ao endereco da proxima instrucao. E assim que
                # o x64 enderaca dado global: RIP-relativo.
                $p = ParsePadrao $op.padrao
                $achou = [Mem]::Scan($base, $size, $p.bytes, $p.mask)
                if ($achou -eq 0) { $res[$op.nome] = $null; continue }
                $b = [Mem]::Read($achou + $op.desloc, 4)
                if ($null -eq $b) { $res[$op.nome] = $null; continue }
                $rel = [BitConverter]::ToInt32($b, 0)
                $res[$op.nome] = @{ instrucao = $achou; alvo = $achou + $op.instrucao + $rel }
            }
            elseif ($op.tipo -eq 'ler') {
                $b = [Mem]::Read($op.endereco, $op.bytes)
                $res[$op.nome] = if ($null -eq $b) { $null } else { [Convert]::ToBase64String($b) }
            }
            elseif ($op.tipo -eq 'snapshot') {
                # Guarda a regiao inteira num arquivo. A comparacao acontece
                # aqui dentro depois: mover 66 MB por chamada de PowerShell
                # seria lento e sem proposito.
                $fs = [System.IO.File]::Create($op.arquivo)
                try {
                    $pos = [long]$op.inicio
                    $fim = $pos + [long]$op.tamanho
                    $bloco = 0x100000
                    while ($pos -lt $fim) {
                        $ler = [int][Math]::Min([long]$bloco, $fim - $pos)
                        $b = [Mem]::Read($pos, $ler)
                        if ($null -eq $b) { $b = New-Object byte[] $ler }
                        $fs.Write($b, 0, $ler)
                        $pos += $ler
                    }
                } finally { $fs.Close() }
                $res[$op.nome] = @{ bytes = [long]$op.tamanho }
            }
            elseif ($op.tipo -eq 'diff') {
                # Compara a memoria de agora com o snapshot e devolve so os
                # deslocamentos cujo u32 subiu exatamente `delta`.
                $fs = [System.IO.File]::OpenRead($op.arquivo)
                $achados = New-Object System.Collections.Generic.List[long]
                try {
                    $bloco = 0x100000
                    $velho = New-Object byte[] $bloco
                    $pos = [long]$op.inicio
                    $desl = [long]0
                    $fim = $pos + [long]$op.tamanho
                    $delta = [long]$op.delta
                    while ($pos -lt $fim -and $achados.Count -lt 200000) {
                        $ler = [int][Math]::Min([long]$bloco, $fim - $pos)
                        $lidosArq = $fs.Read($velho, 0, $ler)
                        if ($lidosArq -le 0) { break }
                        $novo = [Mem]::Read($pos, $lidosArq)
                        if ($null -ne $novo) {
                            for ($i = 0; $i + 4 -le $lidosArq; $i += 4) {
                                $a = [BitConverter]::ToUInt32($velho, $i)
                                $b2 = [BitConverter]::ToUInt32($novo, $i)
                                if (($b2 - $a) -eq $delta) { $achados.Add($desl + $i) }
                            }
                        }
                        $pos += $lidosArq
                        $desl += $lidosArq
                    }
                } finally { $fs.Close() }
                $res[$op.nome] = @{ total = $achados.Count; offsets = @($achados | Select-Object -First 4000) }
            }
            elseif ($op.tipo -eq 'cadeia') {
                # Segue uma cadeia de ponteiros: le 8 bytes, soma o offset,
                # le de novo. O ultimo offset nao e desreferenciado.
                $end = [long]$op.inicio
                $falhou = $false
                foreach ($off in $op.offsets) {
                    $b = [Mem]::Read($end, 8)
                    if ($null -eq $b) { $falhou = $true; break }
                    $end = [BitConverter]::ToInt64($b, 0)
                    if ($end -eq 0) { $falhou = $true; break }
                    $end = $end + [long]$off
                }
                $res[$op.nome] = if ($falhou) { $null } else { $end }
            }
        }
        $out.res = $res
    }
} catch {
    $out.ok = $false
    $out.erro = $_.Exception.Message
} finally {
    [Mem]::Close()
}

$out | ConvertTo-Json -Depth 8 -Compress
