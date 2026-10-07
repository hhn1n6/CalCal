Primary textures: NASA GIBS global maps, downloaded at 4096 x 2048 pixels.

- day-4k.jpg: BlueMarble_ShadedRelief
- night-4k.jpg: VIIRS_Black_Marble, 2016-01-01 composite
- Service: https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi
- Map request: WMS 1.1.1, EPSG:4326, BBOX=-180,-90,180,90,
  WIDTH=4096, HEIGHT=2048, FORMAT=image/jpeg

The renderer uses 4K textures where supported, with the following smaller
Three.js textures as a fallback for limited devices or image-loading failure:

- https://github.com/mrdoob/three.js/blob/dev/examples/textures/planets/earth_atmos_2048.jpg
- https://github.com/mrdoob/three.js/blob/dev/examples/textures/planets/earth_lights_2048.png

These are static illustrative textures. Cloud patterns are not live weather.
The application calculates approximate astronomical sunlight locally, updates
every five minutes when the homepage is visible, and stores a requested location
only on the user's device. Location is not sent to Firebase.
