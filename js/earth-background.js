// Static textures, with sunlight calculated locally. No continuous animation loop.
const canvas=document.getElementById('earth-background');
const home=document.getElementById('page-home');
const artwork=document.querySelector('.home-footer-art');
const status=document.getElementById('earth-location-status');
const locationButton=document.getElementById('earth-use-location');
let location={latitude:22.3193,longitude:114.1694};
let gl,program,ready=false;
try {
  const saved=JSON.parse(localStorage.getItem('calcal-earth-location'));
  if(Number.isFinite(saved?.latitude)&&Number.isFinite(saved?.longitude)&&Math.abs(saved.latitude)<=90&&Math.abs(saved.longitude)<=180){
    location=saved;
    status.textContent='Centered on your saved location.';
  }
} catch {}

const radians=degrees=>degrees*Math.PI/180;
export function sunDirection(time=new Date()){
  const days=time.getTime()/86400000+2440587.5-2451545;
  const anomaly=radians((357.529+0.98560028*days)%360);
  const longitude=radians((280.459+0.98564736*days+1.915*Math.sin(anomaly)+0.02*Math.sin(2*anomaly))%360);
  const obliquity=radians(23.439-0.00000036*days);
  const rightAscension=Math.atan2(Math.cos(obliquity)*Math.sin(longitude),Math.cos(longitude));
  const declination=Math.asin(Math.sin(obliquity)*Math.sin(longitude));
  const sidereal=radians((280.46061837+360.98564736629*days)%360);
  const subsolarLongitude=rightAscension-sidereal;
  return [Math.cos(declination)*Math.cos(subsolarLongitude),Math.sin(declination),Math.cos(declination)*Math.sin(subsolarLongitude)];
}

const vertex=`attribute vec2 position;
varying vec2 uv;
void main(){ uv=position*.5+.5; gl_Position=vec4(position,0.,1.); }`;
const fragment=`precision mediump float;
varying vec2 uv;
uniform vec2 resolution;
uniform vec3 center, east, north, sun;
uniform sampler2D dayMap, nightMap;
void main(){
  vec2 p=(uv-vec2(.5,.38))*resolution/(resolution.x*.95);
  float distanceToCenter=length(p);
  if(distanceToCenter>1.04){ gl_FragColor=vec4(0.); return; }
  if(distanceToCenter>1.){
    float glow=1.-smoothstep(1.,1.04,distanceToCenter);
    gl_FragColor=vec4(vec3(.72),glow*.28); return;
  }
  vec3 normal=normalize(p.x*east+p.y*north+sqrt(max(0.,1.-dot(p,p)))*center);
  vec2 mapUV=vec2(atan(normal.z,normal.x)/6.2831853+.5,acos(clamp(normal.y,-1.,1.))/3.14159265);
  float sunlight=dot(normal,sun);
  float daylight=smoothstep(-.08,.12,sunlight);
  vec3 day=texture2D(dayMap,mapUV).rgb*(.20+.80*max(0.,sunlight));
  vec3 night=texture2D(dayMap,mapUV).rgb*.045+texture2D(nightMap,mapUV).rgb*.85;
  vec3 color=mix(night,day,daylight);
  float rim=pow(distanceToCenter,12.);
  color+=vec3(.10,.30,.48)*rim*(.18+.55*daylight);
  float grey=dot(color,vec3(.2126,.7152,.0722));
  gl_FragColor=vec4(vec3(grey),1.-smoothstep(.995,1.,distanceToCenter));
}`;

function shader(type,source){
  const result=gl.createShader(type); gl.shaderSource(result,source); gl.compileShader(result);
  if(!gl.getShaderParameter(result,gl.COMPILE_STATUS)) throw new Error('Earth shader unavailable');
  return result;
}
function loadImage(path){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=path;});}
function setVector(name,value){gl.uniform3fv(gl.getUniformLocation(program,name),value);}
function render(){
  if(!ready||document.hidden||!home.classList.contains('active')) return;
  const bounds=canvas.getBoundingClientRect();
  if(!bounds.width||!bounds.height) return;
  // Cap the backing buffer, even on high-density iPhone screens.
  const scale=Math.min(window.devicePixelRatio||1,1.5,1200/bounds.width);
  const width=Math.round(bounds.width*scale),height=Math.round(bounds.height*scale);
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
  gl.viewport(0,0,width,height); gl.useProgram(program);
  gl.uniform2f(gl.getUniformLocation(program,'resolution'),width,height);
  const lat=radians(location.latitude),lon=radians(location.longitude);
  setVector('center',[Math.cos(lat)*Math.cos(lon),Math.sin(lat),Math.cos(lat)*Math.sin(lon)]);
  setVector('east',[-Math.sin(lon),0,Math.cos(lon)]);
  setVector('north',[-Math.sin(lat)*Math.cos(lon),Math.cos(lat),-Math.sin(lat)*Math.sin(lon)]);
  setVector('sun',sunDirection());
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
}
async function initialize(){
  try {
    gl=canvas.getContext('webgl',{alpha:true,antialias:false,premultipliedAlpha:false,powerPreference:'low-power'});
    if(!gl) throw new Error('WebGL unavailable');
    program=gl.createProgram();
    gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error('Earth renderer unavailable');
    gl.useProgram(program);
    const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    const attribute=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(attribute);gl.vertexAttribPointer(attribute,2,gl.FLOAT,false,0,0);
    const images=await Promise.all([loadImage('./assets/earth/day.jpg'),loadImage('./assets/earth/night.png')]);
    images.forEach((image,index)=>{
      gl.activeTexture(gl.TEXTURE0+index);gl.bindTexture(gl.TEXTURE_2D,gl.createTexture());
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,image);
      gl.uniform1i(gl.getUniformLocation(program,index?'nightMap':'dayMap'),index);
    });
    ready=true;artwork.classList.add('earth-ready');render();
  }catch(error){
    ready=false;artwork.classList.remove('earth-ready');
    status.textContent='Earth is unavailable on this device. The picture background is shown instead.';
    console.warn('Earth background:',error);
  }
}
locationButton.addEventListener('click',()=>{
  if(!navigator.geolocation){status.textContent='Location is unavailable. Showing Hong Kong preview.';return;}
  locationButton.disabled=true;status.textContent='Finding your location…';
  navigator.geolocation.getCurrentPosition(position=>{
    location={latitude:position.coords.latitude,longitude:position.coords.longitude};
    try{localStorage.setItem('calcal-earth-location',JSON.stringify(location));}catch{}
    status.textContent='Centered on your location. Saved on this device only.';locationButton.disabled=false;render();
  },()=>{status.textContent='Could not get your location. Keeping the current view.';locationButton.disabled=false;},{enableHighAccuracy:false,timeout:10000,maximumAge:3600000});
});
document.getElementById('earth-reset-location').addEventListener('click',()=>{
  location={latitude:22.3193,longitude:114.1694};
  try{localStorage.removeItem('calcal-earth-location');}catch{}
  status.textContent='Hong Kong preview. Sunlight follows the current time.';render();
});
canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();ready=false;artwork.classList.remove('earth-ready');});
canvas.addEventListener('webglcontextrestored',initialize);
window.addEventListener('resize',render);
document.addEventListener('visibilitychange',render);
new MutationObserver(render).observe(home,{attributes:true,attributeFilter:['class']});
setInterval(render,5*60*1000);
initialize();
