// CHAR-IMPORT-01 (kestrel, 2026-10-08): Unity editor exporter for character/prop models -> glTF for
// tools/gltf-import.mjs. Copy this file into <UnityProject>/Assets/Editor/. Docs: tools/README.md "Unity character export".
// Menu: select the assembled character in the scene (e.g. a Synty modular character with only the wanted parts
// active; works in Play mode too) -> Tools > Kestrel > Export character glTF. Exports the ACTIVE renderers only,
// skinned meshes baked in their current pose, relative to the selected root, converted to glTF axes (x mirrored,
// winding flipped). Units: if the model is taller than 10 units it is assumed to be cm and the node gets scale 0.01.
// Colours: each material's base map (_BaseMap/_MainTex/_Texture - Synty POLYGON shaders keep the colour atlas in
// _Texture), else the atlas named by -kestrelAtlas / the "Kestrel.AtlasName" EditorPref. The texture is copied next to the .gltf. Output dir: -kestrelOut, else the "Kestrel.ExportDir"
// EditorPref, else a folder picker.
// Batch (project must be closed in the editor): Unity.exe -batchmode -nographics -quit -projectPath <proj>
//   -executeMethod KestrelGltfExport.Run -kestrelSrc Assets/<model>.fbx -kestrelOut <dir> [-kestrelAtlas <name>]
// Writes <dir>/character.gltf + character.bin + report.json. LICENCE: keep third-party output in git-ignored
// design/local/ + content/local/ unless its licence allows redistribution (repo is public).
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using UnityEditor;
using UnityEngine;

public static class KestrelGltfExport
{
    static string Arg(string name, string def)
    {
        var a = Environment.GetCommandLineArgs();
        for (int i = 0; i < a.Length - 1; i++) if (a[i] == name) return a[i + 1];
        return def;
    }

    [MenuItem("Tools/Kestrel/Export character glTF")]
    public static void Run()
    {
        string src = Arg("-kestrelSrc", "");
        string outDir = Arg("-kestrelOut", EditorPrefs.GetString("Kestrel.ExportDir", ""));
        if (outDir == "" && !Application.isBatchMode)
        {
            outDir = EditorUtility.SaveFolderPanel("Kestrel export folder (e.g. kestrel/design/local/<pack>)", "", "");
            if (outDir == "") return;
            EditorPrefs.SetString("Kestrel.ExportDir", outDir);
        }
        if (outDir == "") { Debug.LogError("KESTREL: no output dir (-kestrelOut)"); EditorApplication.Exit(2); return; }
        Directory.CreateDirectory(outDir);
        // Menu use: export the character SELECTED in the scene (only its active parts), relative to its root.
        GameObject go; bool temp = false;
        var sel = Application.isBatchMode ? null : Selection.activeGameObject;
        if (sel != null && sel.scene.IsValid()) go = sel;
        else
        {
            var asset = src != "" ? AssetDatabase.LoadAssetAtPath<GameObject>(src) : null;
            if (asset == null) { Debug.LogError("KESTREL: select a character in the scene (or check " + src + ")"); if (Application.isBatchMode) EditorApplication.Exit(2); return; }
            go = (GameObject)UnityEngine.Object.Instantiate(asset); temp = true;
            go.transform.position = Vector3.zero; go.transform.rotation = Quaternion.identity; go.transform.localScale = Vector3.one;
        }
        var rootInv = go.transform.worldToLocalMatrix;
        string atlasName = Arg("-kestrelAtlas", EditorPrefs.GetString("Kestrel.AtlasName", ""));
        var atlas = atlasName != "" ? AssetDatabase.FindAssets(atlasName + " t:Texture2D") : new string[0];
        string atlasPath = atlas.Length > 0 ? Path.GetFullPath(AssetDatabase.GUIDToAssetPath(atlas[0])) : "";

        var pos = new List<float>(); var nrm = new List<float>(); var uv = new List<float>();
        var matNames = new List<string>(); var matTex = new List<string>(); var matColor = new List<Color>();
        var prims = new List<List<uint>>();
        var report = new StringBuilder(); report.Append("{\"parts\":[");
        int partN = 0, skipped = 0;

        foreach (var r in go.GetComponentsInChildren<Renderer>(true))
        {
            bool active = r.gameObject.activeInHierarchy && r.enabled;
            Mesh m = null;
            Matrix4x4 xf;
            if (r is SkinnedMeshRenderer smr)
            {
                if (!active || smr.sharedMesh == null) { skipped++; continue; }
                m = new Mesh(); smr.BakeMesh(m, true);
                xf = rootInv * Matrix4x4.TRS(smr.transform.position, smr.transform.rotation, Vector3.one);
            }
            else if (r is MeshRenderer mr)
            {
                var mf = mr.GetComponent<MeshFilter>();
                if (!active || mf == null || mf.sharedMesh == null) { skipped++; continue; }
                m = mf.sharedMesh; xf = rootInv * mr.transform.localToWorldMatrix;
            }
            else { skipped++; continue; }

            var v = m.vertices; var n = m.normals; var t = m.uv;
            int baseV = pos.Count / 3;
            for (int i = 0; i < v.Length; i++)
            {
                var p = xf.MultiplyPoint3x4(v[i]);
                pos.Add(-p.x); pos.Add(p.y); pos.Add(p.z);
                var q = (n != null && n.Length == v.Length) ? xf.MultiplyVector(n[i]).normalized : Vector3.up;
                nrm.Add(-q.x); nrm.Add(q.y); nrm.Add(q.z);
                var w = (t != null && t.Length == v.Length) ? t[i] : Vector2.zero;
                uv.Add(w.x); uv.Add(1f - w.y);
            }
            var mats = r.sharedMaterials;
            for (int s = 0; s < m.subMeshCount; s++)
            {
                var mat = s < mats.Length ? mats[s] : null;
                string mname = mat != null ? mat.name : "none";
                int mi = matNames.IndexOf(mname);
                if (mi < 0)
                {
                    mi = matNames.Count; matNames.Add(mname); prims.Add(new List<uint>());
                    Texture tex = null; Color col = Color.white;
                    if (mat != null)
                    {
                        if (mat.HasProperty("_BaseMap")) tex = mat.GetTexture("_BaseMap");
                        if (tex == null && mat.HasProperty("_MainTex")) tex = mat.GetTexture("_MainTex");
                        if (tex == null && mat.HasProperty("_Texture")) tex = mat.GetTexture("_Texture"); // Synty POLYGON custom shaders: the colour atlas
                        if (mat.HasProperty("_BaseColor")) col = mat.GetColor("_BaseColor");
                        else if (mat.HasProperty("_Color")) col = mat.GetColor("_Color");
                    }
                    // Synty mask shader has no base map: fall back to the pack's colour atlas (same UVs)
                    matTex.Add(tex != null ? Path.GetFullPath(AssetDatabase.GetAssetPath(tex)) : atlasPath);
                    matColor.Add(col);
                }
                var idx = m.GetTriangles(s);
                for (int k = 0; k < idx.Length; k += 3)
                {   // mirrored x -> flip winding
                    prims[mi].Add((uint)(baseV + idx[k])); prims[mi].Add((uint)(baseV + idx[k + 2])); prims[mi].Add((uint)(baseV + idx[k + 1]));
                }
            }
            if (partN++ > 0) report.Append(",");
            report.Append("{\"name\":\"").Append(r.name).Append("\",\"tris\":").Append(m.triangles.Length / 3).Append("}");
        }
        report.Append("],\"skipped\":").Append(skipped).Append(",\"materials\":[");
        for (int i = 0; i < matNames.Count; i++)
        {
            if (i > 0) report.Append(",");
            report.Append("{\"name\":\"").Append(matNames[i]).Append("\",\"tex\":\"").Append(matTex[i].Replace("\\", "/")).Append("\",\"tris\":").Append(prims[i].Count / 3).Append("}");
        }
        report.Append("]}");
        File.WriteAllText(Path.Combine(outDir, "report.json"), report.ToString());

        // --- glTF: one bin (pos, nrm, uv, then indices per material) ---
        var bin = new MemoryStream(); var bw = new BinaryWriter(bin);
        foreach (var f in pos) bw.Write(f); int nrmOff = (int)bin.Length;
        foreach (var f in nrm) bw.Write(f); int uvOff = (int)bin.Length;
        foreach (var f in uv) bw.Write(f);
        var idxOff = new List<int>();
        foreach (var pl in prims) { idxOff.Add((int)bin.Length); foreach (var u in pl) bw.Write(u); }
        bw.Flush();
        File.WriteAllBytes(Path.Combine(outDir, "character.bin"), bin.ToArray());

        int vc = pos.Count / 3;
        float[] mn = { float.MaxValue, float.MaxValue, float.MaxValue }, mx = { float.MinValue, float.MinValue, float.MinValue };
        for (int i = 0; i < vc; i++) for (int a = 0; a < 3; a++) { mn[a] = Math.Min(mn[a], pos[i * 3 + a]); mx[a] = Math.Max(mx[a], pos[i * 3 + a]); }
        string F(float x) => x.ToString("R", System.Globalization.CultureInfo.InvariantCulture);

        float unitScale = (mx[1] - mn[1]) > 10f ? 0.01f : 1f; // cm-sized models (FBX default) -> metres
        var j = new StringBuilder();
        j.Append("{\"asset\":{\"version\":\"2.0\",\"generator\":\"KestrelGltfExport\"},\"scene\":0,\"scenes\":[{\"nodes\":[0]}],\"nodes\":[{\"mesh\":0,\"name\":\"character\",\"scale\":[" + F(unitScale) + "," + F(unitScale) + "," + F(unitScale) + "]}],");
        j.Append("\"buffers\":[{\"uri\":\"character.bin\",\"byteLength\":").Append(bin.Length).Append("}],\"bufferViews\":[");
        j.Append("{\"buffer\":0,\"byteOffset\":0,\"byteLength\":").Append(vc * 12).Append("},");
        j.Append("{\"buffer\":0,\"byteOffset\":").Append(nrmOff).Append(",\"byteLength\":").Append(vc * 12).Append("},");
        j.Append("{\"buffer\":0,\"byteOffset\":").Append(uvOff).Append(",\"byteLength\":").Append(vc * 8).Append("}");
        for (int i = 0; i < prims.Count; i++) j.Append(",{\"buffer\":0,\"byteOffset\":").Append(idxOff[i]).Append(",\"byteLength\":").Append(prims[i].Count * 4).Append("}");
        j.Append("],\"accessors\":[");
        j.Append("{\"bufferView\":0,\"componentType\":5126,\"count\":").Append(vc).Append(",\"type\":\"VEC3\",\"min\":[").Append(F(mn[0])).Append(",").Append(F(mn[1])).Append(",").Append(F(mn[2])).Append("],\"max\":[").Append(F(mx[0])).Append(",").Append(F(mx[1])).Append(",").Append(F(mx[2])).Append("]},");
        j.Append("{\"bufferView\":1,\"componentType\":5126,\"count\":").Append(vc).Append(",\"type\":\"VEC3\"},");
        j.Append("{\"bufferView\":2,\"componentType\":5126,\"count\":").Append(vc).Append(",\"type\":\"VEC2\"}");
        for (int i = 0; i < prims.Count; i++) j.Append(",{\"bufferView\":").Append(3 + i).Append(",\"componentType\":5125,\"count\":").Append(prims[i].Count).Append(",\"type\":\"SCALAR\"}");
        j.Append("],\"images\":[");
        var texList = new List<string>();
        foreach (var t in matTex) if (t != "" && !texList.Contains(t)) texList.Add(t);
        for (int i = 0; i < texList.Count; i++)
        {
            string name = Path.GetFileName(texList[i]);
            File.Copy(texList[i], Path.Combine(outDir, name), true);
            if (i > 0) j.Append(","); j.Append("{\"uri\":\"").Append(Uri.EscapeDataString(name)).Append("\"}");
        }
        j.Append("],\"textures\":[");
        for (int i = 0; i < texList.Count; i++) { if (i > 0) j.Append(","); j.Append("{\"source\":").Append(i).Append("}"); }
        j.Append("],\"materials\":[");
        for (int i = 0; i < matNames.Count; i++)
        {
            if (i > 0) j.Append(",");
            var c = matColor[i];
            j.Append("{\"name\":\"").Append(matNames[i]).Append("\",\"pbrMetallicRoughness\":{\"baseColorFactor\":[").Append(F(c.r)).Append(",").Append(F(c.g)).Append(",").Append(F(c.b)).Append(",1]");
            int ti = texList.IndexOf(matTex[i]);
            if (ti >= 0) j.Append(",\"baseColorTexture\":{\"index\":").Append(ti).Append("}");
            j.Append("}}");
        }
        j.Append("],\"meshes\":[{\"name\":\"character\",\"primitives\":[");
        for (int i = 0; i < prims.Count; i++)
        {
            if (i > 0) j.Append(",");
            j.Append("{\"attributes\":{\"POSITION\":0,\"NORMAL\":1,\"TEXCOORD_0\":2},\"indices\":").Append(3 + i).Append(",\"material\":").Append(i).Append("}");
        }
        j.Append("]}]}");
        File.WriteAllText(Path.Combine(outDir, "character.gltf"), j.ToString());
        Debug.Log("KESTREL: exported " + vc + " verts, " + partN + " parts, " + skipped + " skipped -> " + outDir);
        if (temp) UnityEngine.Object.DestroyImmediate(go);
    }
}
