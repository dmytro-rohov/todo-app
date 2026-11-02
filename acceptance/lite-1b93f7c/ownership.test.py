import unittest
from ownership import verify
class Ownership(unittest.TestCase):
 def test_own(self): verify([{'Labels':{'com.docker.compose.project':'tasks-validation-x','dev.mytko.acceptance':'tasks-lite-x'}}],'tasks-validation-x','tasks-lite-x')
 def test_foreign(self):
  for labels in [{},{'com.docker.compose.project':'other','dev.mytko.acceptance':'tasks-lite-x'}]:
   with self.assertRaises(ValueError):verify([{'Labels':labels}],'tasks-validation-x','tasks-lite-x')
unittest.main()
