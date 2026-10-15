#!/bin/zsh
cd -- "${0:A:h}" || exit 1
umask 077
"./runtime/bin/node" "./scripts/portable-control.mjs" start "$@"
result=$?
if (( result != 0 )) && [[ -t 0 ]]; then
 read "?按回车关闭窗口…"
fi
exit $result
