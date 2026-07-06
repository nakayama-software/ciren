$port = New-Object System.IO.Ports.SerialPort COM22,115200
$port.Open()
$startTime = Get-Date
$timeout = New-TimeSpan -Seconds 120
$allOutput = ""
while ((Get-Date) -lt ($startTime + $timeout)) {
    if ($port.BytesToRead -gt 0) {
        $buf = New-Object char[] 4096
        $count = $port.Read($buf, 0, [Math]::Min($port.BytesToRead, $buf.Length))
        $chunk = -join $buf[0..($count-1)]
        Write-Host -NoNewline $chunk
        $allOutput += $chunk
    } else {
        [System.Threading.Thread]::Sleep(100)
    }
}
$port.Close()
Write-Host "`n--- Monitor ended after 120s ---"