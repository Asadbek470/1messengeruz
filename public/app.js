// Логика фронтенда
document.addEventListener('DOMContentLoaded', () => {
    const loginBtn = document.getElementById('loginBtn');
    
    if (loginBtn) {
        loginBtn.addEventListener('click', () => {
            const user = document.getElementById('username').value;
            if (user) {
                localStorage.setItem('one_messenger_user', user);
                // Переход на страницу чата
                window.location.href = 'chat.html';
            } else {
                alert('Введите имя пользователя');
            }
        });
    }
});
