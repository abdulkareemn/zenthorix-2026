// ProctorAI Verification Screen Logic
document.addEventListener('DOMContentLoaded', () => {
    const video = document.getElementById('verify-video');
    const startWebcamBtn = document.getElementById('btn-start-webcam');
    const captureBtn = document.getElementById('btn-capture');
    const proceedBtn = document.getElementById('btn-proceed');
    
    const checkCamera = document.getElementById('check-camera');
    const checkId = document.getElementById('check-id');
    const checkSystem = document.getElementById('check-system');
    
    const scannerOverlay = document.getElementById('scanner-overlay');
    const statusText = document.getElementById('verify-status-text');
    
    let stream = null;
    
    // Start Webcam access
    startWebcamBtn.addEventListener('click', async () => {
        try {
            stream = await navigator.mediaDevices.getUserMedia({ 
                video: { width: 640, height: 480 },
                audio: true 
            });
            video.srcObject = stream;
            
            // Mark camera checkbox
            checkCamera.classList.remove('checklist-pending');
            checkCamera.classList.add('checklist-success');
            checkCamera.innerHTML = '✓';
            
            // Enable capture button
            captureBtn.removeAttribute('disabled');
            startWebcamBtn.style.display = 'none';
            captureBtn.style.display = 'inline-flex';
            statusText.innerText = 'Camera access granted. Align your face inside the box and click "Verify Identity".';
        } catch (error) {
            console.error('Camera Access Error:', error);
            alert('Could not access camera/microphone. Please ensure permissions are granted in your browser settings.');
        }
    });
    
    // Identity scan simulation
    captureBtn.addEventListener('click', () => {
        captureBtn.setAttribute('disabled', 'true');
        statusText.innerText = 'Scanning facial structure... Keep still.';
        scannerOverlay.style.display = 'block';
        
        // Phase 1: Facial Recognition scan
        setTimeout(() => {
            statusText.innerText = 'Verifying candidate records...';
            
            // Phase 2: System configuration check
            setTimeout(() => {
                checkSystem.classList.remove('checklist-pending');
                checkSystem.classList.add('checklist-success');
                checkSystem.innerHTML = '✓';
                
                statusText.innerText = 'Analyzing identification card...';
                
                // Phase 3: Identity confirmation
                setTimeout(() => {
                    checkId.classList.remove('checklist-pending');
                    checkId.classList.add('checklist-success');
                    checkId.innerHTML = '✓';
                    
                    statusText.innerText = 'Verification complete! You are cleared to take the exam.';
                    scannerOverlay.style.display = 'none';
                    
                    // Enable continue button
                    proceedBtn.removeAttribute('disabled');
                    captureBtn.style.display = 'none';
                    proceedBtn.style.display = 'inline-flex';
                    
                    // Stop streaming temporarily or keep active
                }, 1500);
            }, 1500);
        }, 1500);
    });
    
    // Clean up media streams before moving to next screen
    proceedBtn.addEventListener('click', () => {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
    });
});
