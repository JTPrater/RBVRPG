// list.js
document.addEventListener('DOMContentLoaded', function() {
    const socket = io();
    const passengerGrid = document.getElementById('passengerGrid');

    // Create passenger card
    function createPassengerCard(passenger) {
        const card = document.createElement('div');
        card.className = 'passenger-card';
        
        // Format the date properly
        const birthDate = new Date(passenger.birthdate).toLocaleDateString();
        
        card.innerHTML = `
            <div class="avatar">
                <img src="${passenger.avatar}" alt="${passenger.forename} ${passenger.surname}">
            </div>
            <div class="info">
                <h2>${passenger.forename} ${passenger.surname}</h2>
                <p class="dob">Born: ${birthDate}</p>
                <p class="cabin">Cabin: ${passenger.cabin}</p>
                <div class="bio">
                    <p>${passenger.bio || 'No biography provided.'}</p>
                </div>
            </div>
        `;
        return card;
    }

    // Handle initial passengers load
    socket.on('initial-passengers', (passengers) => {
        console.log('Received initial passengers:', passengers);
        passengerGrid.innerHTML = ''; // Clear existing content
        if (Array.isArray(passengers)) {
            passengers.forEach(passenger => {
                if (passenger) {
                    passengerGrid.appendChild(createPassengerCard(passenger));
                }
            });
        }
    });

    // Handle new passenger additions
    socket.on('new-passenger', (passenger) => {
        console.log('New passenger joined:', passenger);
        if (passenger) {
            passengerGrid.appendChild(createPassengerCard(passenger));
        }
    });
});