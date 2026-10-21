@echo off
title Hoepli - esporta i tuoi libri
cd /d "%~dp0"
node "bin\hoepli.mjs" %*
echo.
pause
