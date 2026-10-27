// Seeded into the account's Firestore catalog on first use; custom entries live there too.
const groups={
  Chest:['Barbell incline press','Barbell bench press','Dumbbell bench press','Incline dumbbell press','Chest press machine','Cable fly','Push-up'],
  Back:['Lat pulldown','Pull-up','Seated cable row','Barbell row','Dumbbell row','Deadlift'],
  Shoulders:['Machine shoulder press','Dumbbell shoulder press','Lateral raise','Rear delt fly','Face pull'],
  Arms:['Cable overhead triceps extension','Triceps pushdown','Barbell curl','Dumbbell curl','Hammer curl'],
  Legs:['Barbell squat','Leg press','Romanian deadlift','Leg extension','Leg curl','Standing calf raise','Lunge'],
  Core:['Cable crunch','Crunch','Hanging leg raise'],
  Cardio:['Treadmill','Exercise bike','Rowing machine','Elliptical'],
};
export const defaultExercises=Object.entries(groups).flatMap(([category,names])=>names.map(name=>({id:'exercise-'+name.toLowerCase().replace(/[^a-z0-9]+/g,'-'),name,category})));
