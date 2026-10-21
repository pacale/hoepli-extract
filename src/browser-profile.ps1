param([int]$Port = 9222)
# The --user-data-dir of the browser listening on the given debugging port.
$match = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
  Where-Object { $_.CommandLine -like "*--remote-debugging-port=$Port*" } |
  Select-Object -First 1
if ($null -eq $match) { exit 0 }
if ($match.CommandLine -match '--user-data-dir="?([^"\s]+)"?') {
  $matches[1]
} elseif ($match.CommandLine -match '--user-data-dir=([^\s]+)') {
  $matches[1]
}
