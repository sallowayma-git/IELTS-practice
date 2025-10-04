; 自定义 NSIS 安装程序脚本
; 用于 Windows 平台的高级安装配置

!macro customInstall
  ; 创建桌面快捷方式
  CreateShortCut "$DESKTOP\IELTS Writing Assistant.lnk" "$INSTDIR\IELTS Writing Assistant.exe"

  ; 创建开始菜单快捷方式
  CreateShortCut "$SMSTARTUP\IELTS Writing Assistant.lnk" "$INSTDIR\IELTS Writing Assistant.exe"

  ; 注册文件关联
  WriteRegStr HKCR ".ielts" "" "IELTSWritingAssistant"
  WriteRegStr HKCR "IELTSWritingAssistant" "" "IELTS Writing Document"
  WriteRegStr HKCR "IELTSWritingAssistant\DefaultIcon" "" "$INSTDIR\IELTS Writing Assistant.exe,0"
  WriteRegStr HKCR "IELTSWritingAssistant\shell\open\command" "" '"$INSTDIR\IELTS Writing Assistant.exe" "%1"'
!macroend

!macro customUnInstall
  ; 删除桌面快捷方式
  Delete "$DESKTOP\IELTS Writing Assistant.lnk"

  ; 删除开始菜单快捷方式
  Delete "$SMSTARTUP\IELTS Writing Assistant.lnk"

  ; 删除文件关联
  DeleteRegKey HKCR ".ielts"
  DeleteRegKey HKCR "IELTSWritingAssistant"

  ; 删除用户数据（可选）
  ; RMDir /r "$APPDATA\IELTS Writing Assistant"
!macroend

; 安装页面自定义
!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
  !insertmacro MUI_PAGE_LICENSE "LICENSE.txt"
  !insertmacro MUI_PAGE_COMPONENTS
  !insertmacro MUI_PAGE_DIRECTORY
  !insertmacro MUI_PAGE_INSTFILES
  !insertmacro MUI_PAGE_FINISH
!macroend