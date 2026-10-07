Earth textures from the official Three.js example assets:

- https://github.com/mrdoob/three.js/blob/dev/examples/textures/planets/earth_atmos_2048.jpg
- https://github.com/mrdoob/three.js/blob/dev/examples/textures/planets/earth_lights_2048.png

These are static illustrative textures. Cloud patterns are not live weather.
The application calculates approximate astronomical sunlight locally, updates
every five minutes when the homepage is visible, and stores a requested location
only on the user's device. Location is not sent to Firebase.
