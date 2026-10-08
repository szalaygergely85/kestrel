// Generated test geometry only: a solid, cream-coloured VOX v150 cube.
// No downloaded or third-party asset is included.
export function makeVoxCube(size) {
  const u32=value=>{const bytes=Buffer.alloc(4);bytes.writeUInt32LE(value);return bytes;};
  const chunk=(id,data)=>Buffer.concat([Buffer.from(id),u32(data.length),u32(0),data]);
  const voxels=Buffer.alloc(4+size**3*4);voxels.writeUInt32LE(size**3);let offset=4;
  for(let x=0;x<size;x++)for(let y=0;y<size;y++)for(let z=0;z<size;z++){
    voxels[offset++]=x;voxels[offset++]=y;voxels[offset++]=z;voxels[offset++]=1;
  }
  const rgba=Buffer.alloc(1024);rgba.set([232,226,208,255]);
  const data=Buffer.concat([chunk('SIZE',Buffer.concat([u32(size),u32(size),u32(size)])),chunk('XYZI',voxels),chunk('RGBA',rgba)]);
  return Buffer.concat([Buffer.from('VOX '),u32(150),Buffer.from('MAIN'),u32(0),u32(data.length),data]);
}
