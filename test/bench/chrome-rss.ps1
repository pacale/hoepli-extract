param([string]$Marker = 'chrome-profile')
# Total working set (MB) of the Chrome processes that belong to the tool.
$p = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
  Where-Object { $_.CommandLine -like "*$Marker*" }
$sum = ($p | Measure-Object -Property WorkingSetSize -Sum).Sum
if ($null -eq $sum) { $sum = 0 }
[math]::Round($sum / 1MB, 1)
