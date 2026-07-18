# YAPCA (Yet Another Plant Care App) - MVP

## Główny problem

Poleganie na własnej pamięci o podlewaniu roślin prowadzi do błędów pielęgnacyjnych roślin, zwłaszcza w przypadku sporych kolekcji.

## Najmniejszy zestaw funkcjonalności

- Lista zadań podlewania roślin na dany dzień z uwzględnieniem zaległych zadań
- Wizualny wskaźnik zaległych zadań (w stylu ostrzezenie/pilne)
- Oznaczanie zadań jako wykonane
- Mozliwość odkładania zadań na 2 dni
- Interwały podlewania jawnie rozdzielone na okresy: wegetacyjny i spoczynku
- Częstotliwość podlewania na podstawie sztywnych interwałów wprowadzonych przez uzytkownika
- Zarządzanie roślinami (CRUD) - nazwa, interwały, zdjęcie
- Dziennik zadań na widoku rośliny
- Prosty system kont użytkowników

## Co NIE wchodzi w zakres MVP

- Zaawansowany model fizyczny uwzględniający typ podłoza, doniczki, gatunku rośliny etc.
- Inne zadania pielęgnacyjne (nawozenie, czyszczenie, przesadzanie, przepłukiwanie)
- Widok przyszłych zadań
- Pomijanie zadań
- Aplikacje mobilne (tylko web)

## Kryteria sukcesu

- Nowy użytkownik jest w stanie założyć i usunąć konto w dowolnym momencie
- Użytkownik może dodać roślinę, zobaczyć ją na dzisiejszej liście zadań i bezbłędnie przeklikać opcję "odłóż na 2 dni" lub "podlane". W przypadku pomyłki, może cofnąć akcję
- Użytkownik może w dowolnym momencie zmienić dane rośliny lub ją usunąć. Zmiana interwałów jest prawidłowo przeliczana
- Uproszczony model częstotliwości działa przewidywalnie: jeśli roślina ma być podlewana co 3 dni, to po kliknięciu "podlane" znika z listy i pojawia się dokładnie za 3 dni.
