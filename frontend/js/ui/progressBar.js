import {
  circularProgress,
  state
} from "../state/state.js";


export function updateProgressBar (){
  
  Array.from(circularProgress).forEach(progressBar => {

    const progressValue = progressBar.querySelector(".percentage");
    const progressText = progressBar.parentElement.querySelector(".progress-text");

    const total = state.tasksArr.length;
    const completed = state.tasksArr.filter(task => task.completed).length;

    const endValue = total === 0 ? 0 : Math.round((completed / total) * 100);

    let startValue = Number(progressBar.getAttribute("data-percentage")) || 0;

    const progressColor = progressBar.getAttribute("data-progress-color");

    progressBar.setAttribute("data-percentage", endValue);
    
    let message = "";

    if (endValue === 0) {
      message = "Zacznij działać 💪";
    } else if (endValue <= 30) {
      message = "Dopiero się rozkręcasz 🚀";
    } else if (endValue <= 70) {
      message = "Świetnie Ci idzie! 🔥";
    } else if (endValue < 100) {
      message = "Już prawie koniec 👀";
    } else {
      message = "Brawo! Wszystko ukończone 🎉";
    }
    if (endValue === 0) {
      progressValue.textContent = `0%`;
      progressText.textContent = message;
      progressBar.style.background = `conic-gradient(${progressColor} 0deg, ${progressBar.getAttribute("data-bg-color")} 0deg)`;
      return;
    }

    if (startValue === endValue) {
      progressValue.textContent = `${endValue}%`;
      progressText.textContent = message; // ✅ już działa
      progressBar.style.background = `conic-gradient(${progressColor} ${endValue * 3.6}deg, ${progressBar.getAttribute("data-bg-color")} 0deg)`;
      return;
    }

    progressText.textContent = message;

    const step = startValue < endValue ? 1 : -1;

    
    // setinterval
    if (progressBar._interval) {
      clearInterval(progressBar._interval);
    }

    progressBar._interval = setInterval(() => {
      startValue += step;

      progressValue.textContent = `${startValue}%`;

      progressBar.style.background = `conic-gradient(${progressColor} ${startValue * 3.6}deg, ${progressBar.getAttribute("data-bg-color")} 0deg)`;

      if (startValue === endValue) {
        clearInterval(progressBar._interval);
      }
    }, 20);
  });
}