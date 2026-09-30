@echo off
REM Sobe o sincronizador do save + o servidor do tracker.
REM Somente leitura: nada aqui escreve no save do Sekiro.

setlocal
REM Este arquivo mora em windows\; o projeto e a pasta acima.
cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js nao encontrado no PATH.
  echo   Instale em https://nodejs.org e abra este .bat de novo.
  echo.
  pause
  exit /b 1
)

echo.
echo   Iniciando... (Ctrl+C para parar)
echo.

node sync\main.js --manual
if errorlevel 1 (
  echo.
  echo   O processo terminou com erro. Rode "npm run selftest" para diagnosticar.
  echo.
)

pause
endlocal
