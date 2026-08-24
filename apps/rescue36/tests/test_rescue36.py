import importlib.util
import tempfile
import unittest
from pathlib import Path

MOD = Path(__file__).resolve().parents[1] / "rescue36.py"
spec = importlib.util.spec_from_file_location("rescue36", MOD)
r36 = importlib.util.module_from_spec(spec)
import sys
sys.modules["rescue36"] = r36
spec.loader.exec_module(r36)


class Rescue36Tests(unittest.TestCase):
    def make_project(self, kotlin=False):
        td = tempfile.TemporaryDirectory()
        root = Path(td.name)
        (root / "app/src/main").mkdir(parents=True)
        (root / "gradle/wrapper").mkdir(parents=True)
        if kotlin:
            build = '''plugins { id("com.android.application") version "8.7.3" }\nandroid { compileSdk = 35\n defaultConfig { targetSdk = 35 } }\n'''
            (root / "build.gradle.kts").write_text(build)
        else:
            build = '''plugins { id 'com.android.application' version '8.7.3' }\nandroid { compileSdkVersion 35\n defaultConfig { targetSdkVersion 35 } }\n'''
            (root / "build.gradle").write_text(build)
        (root / "gradle/wrapper/gradle-wrapper.properties").write_text("distributionUrl=https\\://services.gradle.org/distributions/gradle-8.9-bin.zip")
        manifest = '''<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application><activity android:name=".MainActivity" android:screenOrientation="portrait" /></application></manifest>'''
        (root / "app/src/main/AndroidManifest.xml").write_text(manifest)
        return td, root

    def test_groovy_sdk_agp_gradle(self):
        td, root = self.make_project(False)
        try:
            rep = r36.fix_project(root)
            text = (root / "build.gradle").read_text()
            self.assertIn("compileSdkVersion 36", text)
            self.assertIn("targetSdkVersion 36", text)
            self.assertIn("8.10.2", text)
            self.assertIn("gradle-8.11.1-bin.zip", (root / "gradle/wrapper/gradle-wrapper.properties").read_text())
            self.assertTrue(rep.changed_files)
        finally:
            td.cleanup()

    def test_kotlin_sdk(self):
        td, root = self.make_project(True)
        try:
            r36.fix_project(root)
            text = (root / "build.gradle.kts").read_text()
            self.assertIn("compileSdk = 36", text)
            self.assertIn("targetSdk = 36", text)
        finally:
            td.cleanup()

    def test_predictive_back_optout(self):
        td, root = self.make_project(True)
        try:
            src = root / "app/src/main/MainActivity.kt"
            src.write_text("class MainActivity { fun onBackPressed() {} }")
            r36.fix_project(root)
            manifest = (root / "app/src/main/AndroidManifest.xml").read_text()
            self.assertIn('android:enableOnBackInvokedCallback="false"', manifest)
        finally:
            td.cleanup()

    def test_large_screen_compat(self):
        td, root = self.make_project(True)
        try:
            r36.fix_project(root)
            manifest = (root / "app/src/main/AndroidManifest.xml").read_text()
            self.assertIn("PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY", manifest)
        finally:
            td.cleanup()

    def test_remove_edge_optout(self):
        td, root = self.make_project(True)
        try:
            values = root / "app/src/main/res/values"
            values.mkdir(parents=True)
            styles = values / "styles.xml"
            styles.write_text('<resources><style name="App"><item name="android:windowOptOutEdgeToEdgeEnforcement">true</item></style></resources>')
            r36.fix_project(root)
            self.assertNotIn("windowOptOutEdgeToEdgeEnforcement", styles.read_text())
        finally:
            td.cleanup()

    def test_scan_finds_old_sdk(self):
        td, root = self.make_project(True)
        try:
            rep = r36.scan_project(root)
            self.assertTrue(any(x.code == "SDK_BELOW_36" for x in rep.findings))
        finally:
            td.cleanup()


if __name__ == "__main__":
    unittest.main()
