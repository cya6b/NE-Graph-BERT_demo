import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial';
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Line3, LineSegments, Matrix4, MeshBasicMaterial, Plane, Vector3 } from 'three';
import { IFCBEAM, IFCBUILDINGELEMENTPROXY, IFCCOLUMN, IFCDOOR, IFCFOOTING, IFCFURNISHINGELEMENT, IFCMEMBER, IFCPLATE, IFCPROXY, IFCROOF, IFCSLAB, IFCSTAIRFLIGHT, IFCWALL, IFCWALLSTANDARDCASE, IFCWINDOW } from 'web-ifc';
export class ClippingEdges {
    constructor(clippingPlane) {
        this.edges = {};
        this.isVisible = true;
        this.inverseMatrix = new Matrix4();
        this.localPlane = new Plane();
        this.tempLine = new Line3();
        this.tempVector = new Vector3();
        this.stylesInitialized = false;
        this.clippingPlane = clippingPlane;
    }
    get visible() {
        return this.isVisible;
    }
    set visible(visible) {
        this.isVisible = visible;
        const allEdges = Object.values(this.edges);
        allEdges.forEach((edges) => {
            edges.mesh.visible = visible;
            if (visible)
                ClippingEdges.context.getScene().add(edges.mesh);
            else
                edges.mesh.removeFromParent();
        });
        if (visible)
            this.updateEdges();
    }
    // Initializes the helper geometry used to compute the vertices
    static newGeneratorGeometry() {
        // create line geometry with enough data to hold 100000 segments
        const generatorGeometry = new BufferGeometry();
        const linePosAttr = new BufferAttribute(new Float32Array(300000), 3, false);
        linePosAttr.setUsage(DynamicDrawUsage);
        generatorGeometry.setAttribute('position', linePosAttr);
        return generatorGeometry;
    }
    dispose() {
        Object.values(this.edges).forEach((edge) => {
            if (edge.generatorGeometry.boundsTree)
                edge.generatorGeometry.disposeBoundsTree();
            edge.generatorGeometry.dispose();
            if (edge.mesh.geometry.boundsTree)
                edge.mesh.geometry.disposeBoundsTree();
            edge.mesh.geometry.dispose();
            edge.mesh.removeFromParent();
            edge.mesh = null;
        });
        this.edges = null;
        this.clippingPlane = null;
    }
    disposeStylesAndHelpers() {
        if (ClippingEdges.basicEdges) {
            ClippingEdges.basicEdges.removeFromParent();
            ClippingEdges.basicEdges.geometry.dispose();
            ClippingEdges.basicEdges = null;
            ClippingEdges.basicEdges = new LineSegments();
        }
        ClippingEdges.context = null;
        ClippingEdges.ifc = null;
        ClippingEdges.edgesParent = undefined;
        if (!ClippingEdges.styles)
            return;
        const styles = Object.values(ClippingEdges.styles);
        styles.forEach((style) => {
            style.ids.length = 0;
            style.meshes.forEach((mesh) => {
                mesh.removeFromParent();
                mesh.geometry.dispose();
                if (mesh.geometry.boundsTree)
                    mesh.geometry.disposeBoundsTree();
                if (Array.isArray(mesh.material))
                    mesh.material.forEach((mat) => mat.dispose());
                else
                    mesh.material.dispose();
            });
            style.meshes.length = 0;
            style.categories.length = 0;
            style.material.dispose();
        });
        ClippingEdges.styles = null;
        ClippingEdges.styles = {};
    }
    async updateEdges() {
        if (ClippingEdges.createDefaultIfcStyles) {
            await this.updateIfcStyles();
        }
        if (ClippingEdges.forceStyleUpdate) {
            this.updateSubsetsTranformation();
        }
        Object.keys(ClippingEdges.styles).forEach((styleName) => {
            try {
                // this can trow error if there is an empty mesh, we still want to update other edges so we catch ere
                this.drawEdges(styleName);
            }
            catch (e) {
                console.error('error in drawing edges', e);
            }
        });
    }
    // Creates a new style that applies to all clipping edges for IFC models
    static async newStyle(styleName, categories, material = ClippingEdges.defaultMaterial) {
        const subsets = [];
        const models = ClippingEdges.context.items.ifcModels;
        for (let i = 0; i < models.length; i++) {
            // eslint-disable-next-line no-await-in-loop
            const subset = await ClippingEdges.newSubset(styleName, models[i], categories);
            if (subset) {
                subsets.push(subset);
            }
        }
        material.clippingPlanes = ClippingEdges.context.getClippingPlanes();
        ClippingEdges.styles[styleName] = {
            ids: models.map((model) => model.modelID),
            categories,
            material,
            meshes: subsets
        };
    }
    // Creates a new style that applies to all clipping edges for generic models
    static async newStyleFromMesh(styleName, meshes, material = ClippingEdges.defaultMaterial) {
        const ids = meshes.map((mesh) => mesh.modelID);
        meshes.forEach((mesh) => {
            if (!mesh.geometry.boundsTree)
                mesh.geometry.computeBoundsTree();
        });
        material.clippingPlanes = ClippingEdges.context.getClippingPlanes();
        ClippingEdges.styles[styleName] = {
            ids,
            categories: [],
            material,
            meshes
        };
    }
    async updateStylesIfcGeometry() {
        const styleNames = Object.keys(ClippingEdges.styles);
        for (let i = 0; i < styleNames.length; i++) {
            const name = styleNames[i];
            const style = ClippingEdges.styles[name];
            const models = ClippingEdges.context.items.ifcModels;
            style.meshes.length = 0;
            for (let i = 0; i < models.length; i++) {
                // eslint-disable-next-line no-await-in-loop
                const subset = await ClippingEdges.newSubset(name, models[i], style.categories);
                if (subset) {
                    style.meshes.push(subset);
                }
            }
        }
    }
    updateSubsetsTranformation() {
        const styleNames = Object.keys(ClippingEdges.styles);
        for (let i = 0; i < styleNames.length; i++) {
            const styleName = styleNames[i];
            const style = ClippingEdges.styles[styleName];
            style.meshes.forEach((mesh) => {
                const model = ClippingEdges.context.items.ifcModels.find((model) => model.modelID === mesh.modelID);
                if (model) {
                    mesh.position.copy(model.position);
                    mesh.rotation.copy(model.rotation);
                    mesh.scale.copy(model.scale);
                }
            });
        }
        ClippingEdges.forceStyleUpdate = false;
    }
    async updateIfcStyles() {
        if (!this.stylesInitialized) {
            await this.createDefaultIfcStyles();
        }
        if (ClippingEdges.forceStyleUpdate) {
            await this.updateStylesIfcGeometry();
            ClippingEdges.forceStyleUpdate = false;
        }
    }
    // Creates some basic styles so that users don't have to create it each time
    async createDefaultIfcStyles() {
        if (Object.keys(ClippingEdges.styles).length === 0) {
            await ClippingEdges.newStyle('thick', [
                IFCWALLSTANDARDCASE,