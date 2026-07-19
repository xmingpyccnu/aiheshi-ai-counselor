// 应用初始化
document.addEventListener('DOMContentLoaded', () => {
  // 初始化聊天应用
  const chatApp = new ChatApp();
  
  // 处理启动页
  const splash = document.getElementById('splash');
  const app = document.getElementById('app');
  const enterBtn = document.getElementById('enterBtn');
  
  // 点击进入按钮隐藏启动页
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
      }, 50);
    }, 500);
  });
  
  // 3秒后自动显示进入按钮（如果用户没有点击）
  setTimeout(() => {
    if (!splash.classList.contains('hidden')) {
      enterBtn.style.transform = 'scale(1)';
      enterBtn.style.transition = 'transform 0.3s ease';
    }
  }, 3000);
});
