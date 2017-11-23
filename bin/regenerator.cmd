@IF EXIST "%~dp0\node.exe" (
  "%~dp0\node.exe"  "%~dp0\regenerator" %*
) ELSE (
  @SETLOCAL
  @SET PATHEXT=%PATHEXT:;.JS;=;%
  node  "%~dp0\regenerator" %*
)