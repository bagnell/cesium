attribute vec3 positionHigh;
attribute vec3 positionLow;
attribute vec2 direction;                       // in screen space
attribute vec4 textureCoordinatesAndImageSize;  // size in normalized texture coordinates
attribute vec3 originAndShow;                   // show is 0.0 (false) or 1.0 (true)
attribute vec2 pixelOffset;
attribute vec4 eyeOffsetAndScale;               // eye offset in meters
attribute vec4 rotationAndAlignedAxis;
attribute vec4 scaleByDistance;                 // near, nearScale, far, farScale
attribute vec4 translucencyByDistance;          // near, nearTrans, far, farTrans

#ifdef RENDER_FOR_PICK
attribute vec4 pickColor;
#else
attribute vec4 color;
#endif

const vec2 czm_highResolutionSnapScale = vec2(1.0, 1.0);    // TODO

varying vec2 v_textureCoordinates;

#ifdef RENDER_FOR_PICK
varying vec4 v_pickColor;
#else
varying vec4 v_color;
#endif


void main()
{
    vec2 textureCoordinates = textureCoordinatesAndImageSize.xy;
    float scale = eyeOffsetAndScale.w;
    vec2 imageSize = textureCoordinatesAndImageSize.zw;
    vec2 halfSize = imageSize * scale * czm_highResolutionSnapScale;
    halfSize *= ((direction * 2.0) - 1.0);
    
    vec3 positionWC = positionHigh.xyz;
    positionWC.xy += halfSize;

    gl_Position = czm_viewportOrthographic * vec4(positionWC.xy, -positionWC.z, 1.0);
    v_textureCoordinates = textureCoordinates;

#ifdef RENDER_FOR_PICK
    v_pickColor = pickColor;
#else
    v_color = color;
    //v_color.a *= translucency;
#endif
}
