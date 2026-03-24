@echo off
rem Gradle wrapper for Windows (same invocation as ./gradlew)
setlocal
set "DIRNAME=%~dp0"
pushd "%DIRNAME%"
if not exist "gradle\wrapper\gradle-wrapper.jar" (
  echo gradle-wrapper.jar not found
  popd
  exit /b 1
)
set "JAVA_EXE=java"
if defined JAVA_HOME set "JAVA_EXE=%JAVA_HOME%\bin\java.exe"
"%JAVA_EXE%" -Dfile.encoding=UTF-8 -Xmx64m -Xms64m -classpath "%DIRNAME%gradle\wrapper\gradle-wrapper.jar" org.gradle.wrapper.GradleWrapperMain %*
set EXITCODE=%ERRORLEVEL%
popd
exit /b %EXITCODE%
