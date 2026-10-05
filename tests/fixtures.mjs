// Seed data for the browser tests. The tests' clock is Saturday 3 Oct 2026, 18:00.
const ex = (name, pairs) => ({ name, sets: pairs.map(([weight, reps]) => ({ weight, reps })) });

// Haim's real workout from 23 Sep 2026, imported from a screenshot of his previous app.
export const userWorkout = {
  id: "sep23",
  date: "2026-09-23",
  notes: "",
  source: "import",
  exercises: [
    ex("Bench Press (Dumbbell)", [[44, 10], [44, 9], [32, 3]]),
    ex("Front Squat (Kettlebell)", [[10, 16], [10, 16], [10, 16]]),
    ex("Lat Pulldown (Cable)", [[45, 10], [45, 9], [45, 6], [39, 4]]),
    ex("Seated Row (Close Grip) (Machine)", [[35, 11], [35, 11], [35, 10]]),
    ex("Seated Chest Fly (Machine)", [[32, 11], [32, 10], [32, 7], [27, 4]]),
    ex("Incline Bicep Curl (Dumbbell)", [[14, 10], [10, 5], [14, 8], [10, 4], [14, 5], [10, 4]]),
    ex("Hammer Curl (Dumbbell)", [[7, 11], [5, 8], [7, 7], [5, 6], [7, 9], [5, 6]]),
  ],
};

export const yesterdayWorkout = { id: "oct2", date: "2026-10-02", notes: "", exercises: [ex("Bench Press (Dumbbell)", [[44, 10], [44, 9]])] };

export const settings = (profile = {}) => ({
  profile: {
    unit: "kg", bodyweight: "80", experience: "Intermediate", daysPerWeek: 4, focus: "Strength", coachStyle: "Encouraging",
    notes: "", foodNotes: "", trainingDays: [], trainingTime: "", ...profile,
  },
  goals: [],
  repRanges: {},
});
