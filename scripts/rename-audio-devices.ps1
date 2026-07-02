# Ghost Interviewer AI - Audio Device Rename Guide
# Opens Sound Settings and shows what to rename

Write-Host ""
Write-Host "=== Ghost Interviewer AI - Rename Audio Devices ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Windows blocks registry writes to audio devices." -ForegroundColor Yellow
Write-Host "Use Sound Settings UI to rename (2 min):" -ForegroundColor Yellow
Write-Host ""
Write-Host "STEP 1: Right-click device -> Properties -> Change name at top" -ForegroundColor White
Write-Host ""
Write-Host "--- INPUT (Microphones) --- rename in Recording tab:" -ForegroundColor Green
Write-Host "  Microphone (Realtek, rear jack)   ->  Microphone - Built-in (Rear)" -ForegroundColor White
Write-Host "  Microphone (Realtek, front jack)  ->  Headset Microphone" -ForegroundColor White
Write-Host "  Microphone (GENERAL WEBCAM)       ->  Webcam Microphone" -ForegroundColor White
Write-Host ""
Write-Host "--- OUTPUT (Speakers) --- rename in Playback tab:" -ForegroundColor Green
Write-Host "  U32J59x (first)                   ->  Samsung Monitor 1 (HDMI)" -ForegroundColor White
Write-Host "  U32J59x (second)                  ->  Samsung Monitor 2 (HDMI)" -ForegroundColor White
Write-Host "  PHL 244E5                         ->  PHL Philips Monitor (HDMI)" -ForegroundColor White
Write-Host "  Acer T232HL                       ->  Acer Monitor T232HL (HDMI)" -ForegroundColor White
Write-Host ""
Write-Host "  Speakers, Headphones, CABLE - already OK, skip them." -ForegroundColor DarkGray
Write-Host ""
Write-Host "Opening Sound Settings..." -ForegroundColor Yellow

# Open classic Sound control panel (has rename feature)
Start-Process "mmsys.cpl"

Write-Host ""
Write-Host "TIP: To distinguish 3 'Microphone' entries:" -ForegroundColor Cyan
Write-Host "  1. Right-click each -> Properties -> check 'Jack Information'" -ForegroundColor White
Write-Host "  2. Or speak into each mic and watch the green bar" -ForegroundColor White
Write-Host "  3. GENERAL WEBCAM one shows the webcam driver name" -ForegroundColor White
Write-Host ""
Read-Host "Press Enter when done"
