// vars global
const input = document.querySelector(".add-task-input");
const addBtn = document.querySelector(".add-btn");
const circularProgress = document.querySelectorAll(".circular-progress");

const modalOverlay = document.querySelector(".modal-overlay");

// update date
function formatDateLabel(dateStr) {
  const today = new Date();
  const date = new Date(dateStr);

  const todayKey = today.toISOString().split("T")[0];

  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const yesterdayKey = yesterday.toISOString().split("T")[0];

  if (dateStr === todayKey) return "Dzisiaj";
  if (dateStr === yesterdayKey) return "Wczoraj";

  return date.toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "numeric",
    year: "2-digit"
  });
}

function getTodayKey() {
  return new Date().toISOString().split("T")[0];
}

// group by date
function groupTasksByDate(tasks) {
  return tasks.reduce((acc, task) => {
    if (!acc[task.date]) {
      acc[task.date] = [];
    }
    acc[task.date].push(task);
    return acc;
  }, {});
}

// render all tasks
function renderAllTasks() {
  const container = document.querySelector(".tasks-wrapper");
  container.innerHTML = "";

  const grouped = groupTasksByDate(tasksArr);

  // date sorted
  const sortedDates = Object.keys(grouped).sort((a,b) => b.localeCompare(a));
  if (sortedDates.length === 0) {
  container.innerHTML = "<p>Dodaj swoje pierwsze zadanie klikając przycisk „Dodaj”</p>";
  return;
}

  sortedDates.forEach(date => {
    const tasksForDay = grouped[date];
    const tasksDiv = document.createElement("div");
    tasksDiv.classList.add("tasks");
    tasksDiv.setAttribute("data-date", date);

    tasksDiv.innerHTML = `<div class="tasks-top">
        <div class="task-top__date">
          <div class="label date">${formatDateLabel(date)}</div>
          <span>Moje zadania:</span>
        </div>
        <div class="counter">
          <span>Liczba zadan:</span>
          <span class="how-many">${tasksForDay.length}</span>
        </div>
      </div>
      <ul class="tasks-container"></ul>
      <div class="tasks-bottom">
        <button class="btn third-btn delete-btn" data-date="${date}">Wyczyść wszystko</button>
      </div>`;

      const list = tasksDiv.querySelector(".tasks-container");
      tasksForDay.forEach(task => {
        const li = document.createElement("li");
        const isActive = activeCategoryFilter === task.categoryId;
        li.classList.add("task-item");
        if (isActive) li.classList.add("highlight");
        li.innerHTML = `
        <div class="checkbox-wrapper">
          <input 
            id="${task.id}" 
            type="checkbox" 
            ${task.completed ? "checked" : ""} 
            data-id="${task.id}" 
          />
          <label class="cbx" for="${task.id}"></label>
          <div class="task-item__title-box">
            <label class="lbl ${task.completed ? "done" : ""}" for="${task.id}">
              ${task.title}
            </label>
            <div class="task-item__categories-box">
              <div class="task-item__categories">
                <span class="task-item__indicator" style="background-color:${categories.find(c => c.id === task.categoryId)?.color || '#ccc'}"></span>
                <span class=" task-item__category" style="color: ${categories.find(c => c.id === task.categoryId)?.color || '#ccc'}">
                 ${categories.find(c => c.id === task.categoryId)?.name || "Brak"}
                </span>
              </div>
            </div>
          </div>
          <button class="btn delete-one" data-id="${task.id}"></button>
        </div>`;
        list.appendChild(li);
      });
      container.appendChild(tasksDiv);
  });
  updateProgressBar();
}

// local storage
function saveTasks () {
  localStorage.setItem("tasks", JSON.stringify(tasksArr));
}

let tasksArr = JSON.parse(localStorage.getItem("tasks")) || [
  { id: 1, title: "Raport kwartalny", completed: false, categoryId: 0, date: "2026-04-09" },
  { id: 2, title: "Zakupy", completed: true, categoryId: 1, date: "2026-04-08" }
];

// logic for circle progress bar
function updateProgressBar (){
  
  Array.from(circularProgress).forEach(progressBar => {

    const progressValue = progressBar.querySelector(".percentage");
    const progressText = progressBar.parentElement.querySelector(".progress-text");

    const total = tasksArr.length;
    const completed = tasksArr.filter(task => task.completed).length;

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

// add button
addBtn.addEventListener("click", () => {
  const value = input.value.trim();
  if (!value) return;
  modalOverlay.classList.remove("hidden");
  document.querySelector(".modal-input").value = value;

  // easter author input
  if (input.value.toLowerCase() === "author") {
    alert("Ten piekna TO-DO lista stworzona przez Mytko01");
  }

  input.value = "";
  lockScroll();
});



// input keybord
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    addBtn.click();
  }
});

// delete one
document.addEventListener("click", (e) => {
  if (e.target.classList.contains("delete-one")) {
    const id = Number(e.target.dataset.id);
    tasksArr = tasksArr.filter(task => task.id !== id)
    saveTasks();
    renderAllTasks();
  }
});

// delete all
document.addEventListener("click", (e) => {
  if (e.target.classList.contains("delete-btn")) {
    const date = e.target.dataset.date;
    tasksArr = tasksArr.filter(task => task.date !== date);
    saveTasks();
    renderAllTasks();
  }
});

// toggle checkbox
document.addEventListener("change", (e) => {
  if (e.target.type === "checkbox") {
    const id = Number(e.target.dataset.id);
    const isChecked = e.target.checked;
    tasksArr = tasksArr.map(task =>
      task.id === id
        ? { ...task, completed: isChecked }
        : task
    );
    saveTasks();
    renderAllTasks();
  }
});

// POPUP

function saveCategories() {
  localStorage.setItem("categories", JSON.stringify(categories));
}

// get random color for category
function getRandomColor() {
  const colors = [
    "#4e45e4",
    "#22c55e",
    "#f59e0b",
    "#ef4444",
    "#3b82f6",
    "#a855f7"
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

let activeCategoryFilter = null;
 
// categories array
let categories = JSON.parse(localStorage.getItem("categories")) || [
  { id: 1, name: "Praca", color: "#4e45e4" },
  { id: 2, name: "Dom", color: "#22c55e" }
]

// render categories
function renderCategoriesModal() {
  const list = document.querySelector(".modal-categories");
  list.innerHTML = categories.map(cat => `
    <li class='modal-category' data-id="${cat.id}">
      <span href="" class="category">${cat.name}</span>
      <button class="delete-one"></button>
    </li>
  `).join("");
}

// counter categories in UL list
function renderCategories() {
  const list = document.querySelector(".categories-list");
  list.innerHTML = categories.map(cat => {
    const count = tasksArr.filter(t => t.categoryId === cat.id).length;
    return `
      <li class="category-item">
        <div class="category-item__box">
          <span style="background-color: ${cat.color}" class='category-item__color'></span>
          <p>${cat.name}</p>
        </div>
        <span class="category-item__number">${count}</span>
      </li>
    `;
  }).join("");
}

document.querySelector(".categories-list").addEventListener("click", (e) => {
  const li = e.target.closest(".category-item");
  if (!li) return;

  const index = [...li.parentElement.children].indexOf(li);
  const category = categories[index];

  // toggle click
  if (activeCategoryFilter == category.id) {
    activeCategoryFilter = null;
  } else {
    activeCategoryFilter = category.id;
  }
  renderAllTasks();
})

// show input to add category
document.querySelector(".add-category-btn").addEventListener("click", () => {
  document.querySelector(".new-category").classList.remove("hidden");
})

// add new category ENTER key
document.querySelector(".new-category-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const value = e.target.value.trim();
    if (!value) return;

    const newCategory = {
      id: Date.now(),
      name: value,
      color: getRandomColor()
    };
    categories.push(newCategory);
    saveCategories();
    renderCategoriesModal();
    renderCategories();

    e.target.value = "";
    document.querySelector(".new-category").classList.add("hidden");
  }
});

//add task from modal level
document.querySelector(".confirm-btn").addEventListener("click", () => {
  const title = document.querySelector(".modal-input").value.trim();
  if (!title) return;

  if (!selectedCategoryId) {
    alert("Wybierz kategorię");
    return;
  }

  const todayKey = getTodayKey();

  modalOverlay.classList.add("hidden");
  unlockScroll();

  const newTask = {
    id: Date.now(),
    title,
    completed: false,
    categoryId: selectedCategoryId,
    date: todayKey
  };

  tasksArr.push(newTask);
  saveTasks();
  renderAllTasks();
  renderCategories();


  selectedCategoryId = null;
  document.querySelectorAll(".modal-categories li").forEach(el => {
    el.classList.remove("active");
  })
})

// close popups
document.querySelectorAll(".cancel-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    modalOverlay.classList.add("hidden");
    unlockScroll();
  })
})

// select category in UL list and add active class
let selectedCategoryId = null;

document.querySelector(".modal-categories").addEventListener("click", (e) => {
  const li = e.target.closest("li");
  if (!li) return;

  const id = Number(li.dataset.id);

  if (e.target.classList.contains("delete-one")) {
    // delete category
    categories = categories.filter(cat => cat.id !== id);
    // delete relation from tasks
    tasksArr = tasksArr.map(task => task.categoryId === id ? { ...task, categoryId: null } : task);
    saveCategories();
    renderCategoriesModal();
    renderCategories();
    return;
  }

  selectedCategoryId = id;

  document.querySelectorAll(".modal-categories li").forEach(el =>
    el.classList.remove("active")
  );

  li.classList.add("active");
});

// lock scroll
let scrollY = 0;
function lockScroll() {
  scrollY = window.scrollY;

  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
  document.body.style.paddingRight = `${scrollbarWidth}px`;

  document.body.style.position = "fixed";
  document.body.style.top = `-${scrollY}px`;
  document.body.style.left = "0";
  document.body.style.right = "0";
}

function unlockScroll() {
  document.body.style.position = "";
  document.body.style.top = ``;
  document.body.style.left = "";
  document.body.style.right = "";
  window.scrollTo(0, scrollY);
}

// close popup clicking at bg
modalOverlay.addEventListener("click", (e) => {
  if (e.target.classList.contains("modal-overlay")) {
    e.target.classList.add("hidden");
    unlockScroll();
  }
});
 
renderCategoriesModal();
renderCategories();
renderAllTasks();

// easter 
let count = 0;
document.querySelector(".h1").addEventListener("click", () => {
  count++;
  if (count === 3) {
    alert("🎉 Znalazłeś sekret! Dodaj kolejne zadanie :)");
  }
})





console.log(`
████████╗ ██████╗ ██████╗  ██████╗ 
╚══██╔══╝██╔═══██╗██╔══██╗██╔═══██╗
   ██║   ██║   ██║██║  ██║██║   ██║
   ██║   ██║   ██║██║  ██║██║   ██║
   ██║   ╚██████╔╝██████╔╝╚██████╔╝

Created by Mytko01
`);