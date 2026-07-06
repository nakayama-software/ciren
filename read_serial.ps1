$port = New-Object System.IO.Ports.SerialPort COM22,115200
$port.Open()
[System.Threading.Thread]::Sleep(5000)
$buf = New-Object char[] 8192
$count = $port.Read($buf, 0, $buf.Length)
$port.Close()
$text = -join $buf[0..($count-1)]
Write-Output $text