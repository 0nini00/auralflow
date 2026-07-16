@echo off
setlocal EnableExtensions
set "PATH=C:\Windows\System32;C:\Windows;C:\Windows\System32\Wbem;C:\Users\chenle\.cargo\bin;D:\node_global;C:\Users\chenle\bin;%PATH%"
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" || exit /b 1
set "PATH=C:\Windows\System32;C:\Windows;C:\Users\chenle\.cargo\bin;D:\node_global;C:\Users\chenle\bin;%PATH%"
set "CI="
set "GITHUB_ACTIONS="
set "CONTINUOUS_INTEGRATION="
set "WINSDK_VER=10.0.26100.0"
set "WINSDK_LIB=C:\Program Files (x86)\Windows Kits\10\Lib\%WINSDK_VER%"
set "WINSDK_INC=C:\Program Files (x86)\Windows Kits\10\Include\%WINSDK_VER%"
set "LIB=%WINSDK_LIB%\um\x64;%WINSDK_LIB%\ucrt\x64;%LIB%"
set "INCLUDE=%WINSDK_INC%\um;%WINSDK_INC%\ucrt;%WINSDK_INC%\shared;%INCLUDE%"
cd /d C:\Users\chenle\Desktop\auralflow\desktop
if not exist dist\index.html (
  echo frontend dist missing
  exit /b 1
)
node_modules\.bin\tauri.cmd build
exit /b %ERRORLEVEL%
