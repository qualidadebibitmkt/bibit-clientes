@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo  bibit-clientes - deploy completo
echo ============================================
echo.

set "NODEDIR=%ProgramFiles%\nodejs"
if not exist "%NODEDIR%\npx.cmd" set "NODEDIR=%ProgramFiles(x86)%\nodejs"
if exist "%NODEDIR%\npx.cmd" (
  set "NPX=%NODEDIR%\npx.cmd"
) else (
  where npx >nul 2>&1
  if errorlevel 1 (
    echo Node nao encontrado. Instale a versao LTS em https://nodejs.org
    echo e rode este arquivo de novo.
    pause
    exit /b 1
  )
  set "NPX=npx"
)

echo [0/3] Login na Vercel
echo Escolha o metodo com as SETAS e aperte ENTER - o navegador
echo abre para autenticar. Use a conta do team bibit-marketing.
echo.
call "%NPX%" --yes vercel login
if errorlevel 1 goto :fail
echo.

echo [1/3] Subindo o projeto para producao (escopo bibit-marketing)...
call "%NPX%" --yes vercel --prod --yes --scope bibit-marketing
if errorlevel 1 goto :fail
echo.

echo [2/3] Configurando CLICKUP_API_TOKEN...
echo pk_290577377_VBEJBA3MG179BNCDZKK9GEUXSMFIEDSJ| call "%NPX%" --yes vercel env add CLICKUP_API_TOKEN production
echo (se apareceu "already exists" acima, tudo bem - a variavel ja estava la)
echo.

echo [3/3] Redeploy para a API pegar o token...
call "%NPX%" --yes vercel --prod --yes
if errorlevel 1 goto :fail

echo.
echo ============================================
echo  Pronto de verdade! Copie a URL que a
echo  Vercel mostrou acima e abra no navegador.
echo  ATENCAO: este arquivo contem seu token do
echo  ClickUp - apague o deploy.bat apos o uso.
echo ============================================
pause
exit /b 0

:fail
echo.
echo ============================================
echo  Algo falhou neste passo. Tire um print
echo  desta janela e mande no chat que eu corrijo.
echo ============================================
pause
exit /b 1
