# Test Script for Tutor Notification

Write-Host "===== TOP TUTORS NOTIFICATION TEST =====" -ForegroundColor Cyan

# Step 1: Login as student
Write-Host "Step 1: Logging in as student..." -ForegroundColor Yellow
$loginBody = '{"email":"student@toptutor.com","password":"Student123!"}'

try {
    $loginResponse = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/auth/login" -Method POST -Body $loginBody -ContentType "application/json"
    $token = $loginResponse.data.tokens.accessToken
    Write-Host "Login successful!" -ForegroundColor Green
} catch {
    Write-Host "Login failed: $_" -ForegroundColor Red
    exit 1
}

# Step 2: Send a NEW message
Write-Host "Step 2: Sending NEW message..." -ForegroundColor Yellow
$timestamp = Get-Date -Format "HH:mm:ss"
$messageBody = "{`"content`":`"How do I upgrade RAM in my computer? Test at $timestamp`",`"messageType`":`"TEXT`"}"

$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type" = "application/json"
}

try {
    $messageResponse = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/messages/send" -Method POST -Body $messageBody -Headers $headers
    Write-Host "Message sent!" -ForegroundColor Green
    Write-Host "Conversation ID: $($messageResponse.data.conversation.id)" -ForegroundColor Gray
    Write-Host "Subject: $($messageResponse.data.conversation.subject)" -ForegroundColor Gray
    Write-Host "Is New: $($messageResponse.data.isNewConversation)" -ForegroundColor Gray
    
    if ($messageResponse.data.isNewConversation) {
        Write-Host ""
        Write-Host "===== NOTIFICATION SHOULD BE SENT! =====" -ForegroundColor Magenta
        Write-Host "Check backend logs for BROADCASTING" -ForegroundColor Magenta
    }
} catch {
    Write-Host "Message failed: $_" -ForegroundColor Red
}

Write-Host "===== TEST COMPLETE =====" -ForegroundColor Cyan
