// registration.js
document.addEventListener('DOMContentLoaded', function() {
    const birthdateInput = document.getElementById('birthdate');
    const ageDisplay = document.getElementById('age-display');
    const avatarInput = document.getElementById('avatar');
    const avatarPreview = document.getElementById('avatar-preview');
    const form = document.getElementById('registrationForm');

    // Set birthdate constraints
    const minDate = new Date('1819-01-01');
    const maxDate = new Date('1919-07-09');
    
    birthdateInput.min = '1819-01-01';
    birthdateInput.max = '1919-07-09';

    function isValidDate(date) {
        return date >= minDate && date <= maxDate;
    }

    function displayDateError(show) {
        const errorMsg = birthdateInput.parentElement.querySelector('.error-message') || 
            (() => {
                const div = document.createElement('div');
                div.className = 'error-message';
                div.textContent = 'Date must be between January 1st, 1819 and July 9th, 1919';
                birthdateInput.parentElement.appendChild(div);
                return div;
            })();
        
        errorMsg.style.display = show ? 'block' : 'none';
        birthdateInput.style.borderColor = show ? '#e74c3c' : '#c0932b';
    }

    // Calculate age as of July 9th, 1919
    birthdateInput.addEventListener('change', function() {
        const birthDate = new Date(this.value);
        
        if (!isValidDate(birthDate)) {
            displayDateError(true);
            ageDisplay.textContent = '';
            return;
        }

        displayDateError(false);
        const voyageDate = new Date('1919-07-09');
        
        let age = voyageDate.getFullYear() - birthDate.getFullYear();
        const monthDiff = voyageDate.getMonth() - birthDate.getMonth();
        
        if (monthDiff < 0 || (monthDiff === 0 && voyageDate.getDate() < birthDate.getDate())) {
            age--;
        }
        
        ageDisplay.textContent = `Age during voyage: ${age} years`;
    });

    // Avatar preview
    avatarInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(e) {
                avatarPreview.style.backgroundImage = `url(${e.target.result})`;
                avatarPreview.style.backgroundSize = 'cover';
            };
            reader.readAsDataURL(file);
        }
    });

    // Form submission
    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        console.log('Form submission started');
        
        const birthDate = new Date(birthdateInput.value);
        console.log('Birth date:', birthDate);
        
        if (!isValidDate(birthDate)) {
            console.log('Invalid birth date');
            displayDateError(true);
            return;
        }
        
        const formData = new FormData(this);
        
        // Log each form field
        for (let [key, value] of formData.entries()) {
            console.log(`${key}:`, value);
        }
        
        try {
            console.log('Sending request to /api/register');
            const response = await fetch('/api/register', {
                method: 'POST',
                body: formData
            });
            
            console.log('Response status:', response.status);
            console.log('Response headers:', response.headers);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Server error response:', errorText);
                throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
            }
            
            const result = await response.json();
            console.log('Server response:', result);
            
            if (result.success) {
                console.log('Registration successful, storing character data');
                sessionStorage.setItem('character', JSON.stringify(result.passenger));
                window.location.href = '/main/list.html';
            } else {
                console.error('Registration failed:', result.error);
                alert('Registration failed: ' + (result.error || 'Unknown error'));
            }
        } catch (error) {
            console.error('Registration error details:', error);
            alert('Registration failed. Please check your input and try again.');
        }
    });
});