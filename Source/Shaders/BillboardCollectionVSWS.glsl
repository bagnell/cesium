attribute vec3 positionHigh;
attribute vec3 positionLow;
attribute vec2 direction;                       // in screen space
attribute vec4 textureCoordinatesAndImageSize;  // size in normalized texture coordinates
attribute vec3 originAndShow;                   // show is 0.0 (false) or 1.0 (true)
attribute vec4 pixelOffsetAndTranslate;         // x,y, translateX, translateY
attribute vec4 eyeOffsetAndScale;               // eye offset in meters
attribute vec4 rotationAndAlignedAxis;
attribute vec4 scaleByDistance;                 // near, nearScale, far, farScale
attribute vec4 translucencyByDistance;          // near, nearTrans, far, farTrans
attribute vec4 pixelOffsetScaleByDistance;      // near, nearScale, far, farScale

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

float getNearFarScalar(vec4 nearFarScalar, float cameraDistSq)
{
    float valueAtMin = nearFarScalar.y;
    float valueAtMax = nearFarScalar.w;
    float nearDistanceSq = nearFarScalar.x * nearFarScalar.x;
    float farDistanceSq = nearFarScalar.z * nearFarScalar.z;

    // ensure that t will fall within the range of [0.0, 1.0]
    cameraDistSq = clamp(cameraDistSq, nearDistanceSq, farDistanceSq);

    float t = (cameraDistSq - nearDistanceSq) / (farDistanceSq - nearDistanceSq);

    t = pow(t, 0.15);

    return mix(valueAtMin, valueAtMax, t);
}

void main() 
{
    // Modifying this shader may also require modifications to Billboard.computeScreenSpacePosition
    
    // unpack attributes
    vec3 eyeOffset = eyeOffsetAndScale.xyz;
    float scale = eyeOffsetAndScale.w;
    vec2 textureCoordinates = textureCoordinatesAndImageSize.xy;
    vec2 imageSize = textureCoordinatesAndImageSize.zw;
    vec2 origin = originAndShow.xy;
    float show = originAndShow.z;
    vec2 pixelOffset = pixelOffsetAndTranslate.xy;
    vec2 translate = pixelOffsetAndTranslate.zw;

    float translucency = 1.0;

    vec3 positionWC = positionHigh;
    
    vec2 halfSize = imageSize * scale * czm_highResolutionSnapScale;
    halfSize *= ((direction * 2.0) - 1.0);
    
    positionWC.xy += (origin * abs(halfSize));
    positionWC.xy += halfSize;
    positionWC.xy += translate;
    positionWC.xy += (pixelOffset * czm_highResolutionSnapScale);

    gl_Position = czm_viewportOrthographic * vec4(positionWC.xy, -positionWC.z, 1.0);
    v_textureCoordinates = textureCoordinates;

#ifdef RENDER_FOR_PICK
    v_pickColor = pickColor;
#else
    v_color = color;
    //v_color.a *= translucency;
#endif
}
