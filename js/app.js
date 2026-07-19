// 应用初始化
document.addEventListener('DOMContentLoaded', () => {
  const chatApp = new ChatApp();
  window.chatApp = chatApp;
  
  // 处理启动页
  const splash = document.getElementById('splash');
  const app = document.getElementById('app');
  const enterBtn = document.getElementById('enterBtn');
  
  enterBtn.addEventListener('click', () => {
    splash.style.opacity = '0';
    splash.style.transition = 'opacity 0.5s ease';
    
    setTimeout(() => {
      splash.classList.add('hidden');
      app.classList.remove('hidden');
      app.style.opacity = '0';
      app.style.transition = 'opacity 0.5s ease';
      
      setTimeout(() => {
        app.style.opacity = '1';
        chatApp.navigateTo('home');
      }, 50);
    }, 500);
  });
  
  setTimeout(() => {
    if (!splash.classList.contains('hidden')) {
      enterBtn.style.transform = 'scale(1)';
      enterBtn.style.transition = 'transform 0.3s ease';
    }
  }, 3000);
});
