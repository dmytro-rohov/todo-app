export function initEasters() {
    
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

}