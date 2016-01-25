/*global require*/
require({
            baseUrl : '.',
            paths : {
                domReady : '../../ThirdParty/requirejs-2.1.20/domReady',
                Cesium : '../../Source'
            }
        }, [
    'Cesium/Core/BoundingRectangle',
    'Cesium/Core/Cartesian2',
    'Cesium/Core/Cartesian3',
    'Cesium/Core/Cartesian4',
    'Cesium/Core/Color',
    'Cesium/Core/ColorGeometryInstanceAttribute',
    'Cesium/Core/defined',
    'Cesium/Core/GeometryInstance',
    'Cesium/Core/Math',
    'Cesium/Core/Matrix4',
    'Cesium/Core/ScreenSpaceEventHandler',
    'Cesium/Core/ScreenSpaceEventType',
    'Cesium/Core/SimplePolylineGeometry',
    'Cesium/DataSources/KmlDataSource',
    'Cesium/Scene/Billboard',
    'Cesium/Scene/PerInstanceColorAppearance',
    'Cesium/Scene/Primitive',
    'Cesium/Scene/SceneTransforms',
    'Cesium/ThirdParty/when',
    'Cesium/Widgets/Viewer/Viewer',
    'domReady!'
], function(
    BoundingRectangle,
    Cartesian2,
    Cartesian3,
    Cartesian4,
    Color,
    ColorGeometryInstanceAttribute,
    defined,
    GeometryInstance,
    CesiumMath,
    Matrix4,
    ScreenSpaceEventHandler,
    ScreenSpaceEventType,
    SimplePolylineGeometry,
    KmlDataSource,
    Billboard,
    PerInstanceColorAppearance,
    Primitive,
    SceneTransforms,
    when,
    Viewer) {
    "use strict";


    var loadingIndicator = document.getElementById('loadingIndicator');
    var viewer = new Viewer('cesiumContainer', {
        selectionIndicator : false
    });

    var kmlPromise = KmlDataSource.load('./KML/mcs.kmz');
    viewer.dataSources.add(kmlPromise);

    when(kmlPromise).then(function(dataSource) {
        var values = dataSource.entities.values;
        var length = values.length;

        for (var i = 0; i < length; ++i) {
            var entity = values[i];
            if (defined(entity.billboard) && defined(entity.label)) {
                entity.label.show = false;
            }
        }
    });

    var scene = viewer.scene;

    function wgs84ToWindowCoordinates(position) {
        var actualPosition = SceneTransforms.computeActualWgs84Position(scene.frameState, position);
        var camera = scene.camera;
        var viewProjection = Matrix4.multiply(camera.frustum.projectionMatrix, camera.viewMatrix, new Matrix4());
        var positionCC = new Cartesian4();
        Matrix4.multiplyByVector(viewProjection, Cartesian4.fromElements(actualPosition.x, actualPosition.y, actualPosition.z, 1.0, positionCC), positionCC);

        var result = new Cartesian3();
        SceneTransforms.clipToGLWindowCoordinates(scene, positionCC, result);
        result.y = scene.canvas.clientHeight - result.y;
        result.z = positionCC.z / positionCC.w;
        return result;
    }

    var pickedEntities;
    var lines;
    var linePrimitive;
    var radius;
    var centerPosition = new Cartesian3();
    var padding = 10.0;

    var handler = new ScreenSpaceEventHandler(scene.canvas);
    handler.setInputAction(function(movement) {
        if (!defined(pickedEntities)) {
            var pickedObjects = scene.drillPick(movement.position);
            if (defined(pickedObjects) && pickedObjects.length > 1) {
                pickedEntities = [];
                lines = [];

                var angle = 0.0;
                var angleIncrease;
                var magnitude;
                var magIncrease;
                var maxDimension;

                for (var i = 0; i < pickedObjects.length; ++i) {
                    var object = pickedObjects[i];
                    if (object.primitive instanceof Billboard) {
                        if (pickedEntities.length === 0) {
                            Cartesian3.clone(object.primitive.position, centerPosition);
                        }

                        pickedEntities.push(object);

                        if (!defined(angleIncrease)) {
                            var width = object.primitive.width;
                            var height = object.primitive.height;
                            maxDimension = Math.max(width, height) + padding;
                            magnitude = maxDimension + maxDimension * 0.5;
                            magIncrease = magnitude;
                            angleIncrease = maxDimension / magnitude;
                        }

                        var x = magnitude * Math.cos(angle);
                        var y = magnitude * Math.sin(angle);

                        var offset = new Cartesian2(x, -y);
                        object.id.billboard.pixelOffset = offset;
                        if (defined(object.id.label)) {
                            object.id.label.pixelOffset = offset;
                        }

                        var position = wgs84ToWindowCoordinates(object.primitive.position);
                        position.x += offset.x;
                        position.y += offset.y;
                        var worldPosition = SceneTransforms.drawingBufferToWgs84Coordinates(scene, position, position.z);
                        lines.push(worldPosition);

                        angle += angleIncrease;
                        if (angle + angleIncrease * 0.5 > CesiumMath.TWO_PI) {
                            magnitude += magIncrease;
                            angle = 0.0;
                            angleIncrease = maxDimension / magnitude;
                        }
                    }
                }

                var instances = [];
                for (var j = 0; j < lines.length; ++j) {
                    instances.push(new GeometryInstance({
                        geometry : new SimplePolylineGeometry({
                            positions : [centerPosition, lines[j]],
                            followSurface : false,
                            granularity : CesiumMath.PI_OVER_FOUR
                        }),
                        attributes : {
                            color : ColorGeometryInstanceAttribute.fromColor(Color.WHITE)
                        }
                    }));
                }

                linePrimitive = scene.primitives.add(new Primitive({
                    geometryInstances : instances,
                    appearance : new PerInstanceColorAppearance({
                        flat : true,
                        translucent : false
                    }),
                    asynchronous : true
                }));

                lines = undefined;
                viewer.selectedEntity = undefined;
                radius = magnitude + magIncrease;
            }
        }
    }, ScreenSpaceEventType.LEFT_CLICK);

    scene.camera.moveStart.addEventListener(function() {
        if (!defined(radius)) {
            return;
        }
        
        for (var i = 0; i < pickedEntities.length; ++i) {
            var entity = pickedEntities[i].id;
            entity.billboard.pixelOffset = new Cartesian2(0.0, 0.0);
            if (defined(entity.label)) {
                entity.label.pixelOffset = new Cartesian2(0.0, 0.0);
                entity.label.show = false;
            }
        }
        scene.primitives.remove(linePrimitive);
        linePrimitive = undefined;
        pickedEntities = undefined;
        radius = undefined;
    });

    var currentObject;

    handler.setInputAction(function(movement) {
        if (defined(radius)) {
            var screenPosition = SceneTransforms.wgs84ToWindowCoordinates(scene, centerPosition);

            var position = movement.endPosition;
            if (Cartesian2.distance(position, screenPosition) > radius) {
                for (var i = 0; i < pickedEntities.length; ++i) {
                    var entity = pickedEntities[i].id;
                    entity.billboard.pixelOffset = new Cartesian2(0.0, 0.0);
                    if (defined(entity.label)) {
                        entity.label.pixelOffset = new Cartesian2(0.0, 0.0);
                        entity.label.show = false;
                    }
                }
                scene.primitives.remove(linePrimitive);
                linePrimitive = undefined;
                pickedEntities = undefined;
                radius = undefined;
            } else {
                var pickedObject = scene.pick(movement.endPosition);
                if (pickedObject !== currentObject) {
                    if (defined(pickedObject) && pickedObject.primitive instanceof Billboard && defined(pickedObject.id.label)) {
                        if (defined(currentObject)) {
                            currentObject.id.label.show = false;
                        }

                        currentObject = pickedObject;
                        pickedObject.id.label.show = true;
                        pickedObject.id.label.eyeOffset = new Cartesian3(0.0, 0.0, -100.0);
                    } else if (defined(currentObject)) {
                        currentObject.id.label.show = false;
                        currentObject = undefined;
                    }
                }
            }
        }
    }, ScreenSpaceEventType.MOUSE_MOVE);

    loadingIndicator.style.display = 'none';
});