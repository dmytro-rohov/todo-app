# Todo App

## Opis projektu

Aplikacja typu Todo List wykonana w pełnym stacku (frontend + backend + baza danych).  
Umożliwia zarządzanie zadaniami oraz kategoriami z pełną integracją z bazą danych PostgreSQL.

Projekt został wykonany bez frameworków frontendowych (Vanilla JS), aby pokazać zrozumienie działania komunikacji klient–serwer oraz REST API.

---

## Technologie

### Frontend
- HTML
- CSS
- JavaScript (Vanilla JS)
- Fetch API

### Backend
- Node.js
- Express.js
- REST API

### Baza danych
- PostgreSQL

---

## Funkcjonalności

### Zadania (Tasks)
- Dodawanie nowych zadań
- Usuwanie pojedynczych zadań
- Usuwanie wszystkich zadań z danej daty
- Edycja zadań (update)
- Oznaczanie zadań jako wykonane
- Grupowanie zadań według daty

### Kategorie (Categories)
- Dodawanie kategorii
- Usuwanie kategorii
- Przypisywanie kategorii do zadań
- Licznik zadań w kategoriach

### Dodatkowe funkcjonalności
- Walidacja danych po stronie backendu
- Obsługa błędów API
- Formatowanie dat (Dzisiaj / Wczoraj / konkretna data)
- Przechowywanie danych w PostgreSQL (brak localStorage)

---

## Architektura aplikacji

Aplikacja działa w architekturze klient–serwer:

- Frontend komunikuje się z backendem poprzez HTTP (Fetch API)
- Backend udostępnia REST API
- Dane przechowywane są w bazie PostgreSQL
- Relacje między tabelami:
  - tasks.category_id -> categories.id (FOREIGN KEY)

---

## Struktura bazy danych

### Tabela: tasks

- id (PRIMARY KEY)
- title (VARCHAR)
- completed (BOOLEAN)
- date (DATE)
- category_id (FOREIGN KEY)

### Tabela: categories

- id (PRIMARY KEY)
- name (VARCHAR)
- color (VARCHAR)

---

## Instalacja i uruchomienie projektu

### 1. Klonowanie repozytorium
```bash
1. git clone <URL_REPOZYTORIUM>
cd todo

2. Pobrac backend dependencies
cd todo-backend
npm install

3. Stworzyc baze danych 
createdb todo_app

4. Zimportowac baze danych z schmematu
psql -U postgres -d todo_app -f database.sql

5. Odpalic server
npm run dev
```

# Stopka

zrobione przez mytko.dev
