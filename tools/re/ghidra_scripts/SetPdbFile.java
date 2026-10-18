// Prescript headless : force le PDB utilise par l'analyseur "PDB Universal".
// Usage : -preScript SetPdbFile.java <chemin.pdb>
//@category Satisfactory
import java.io.File;

import ghidra.app.plugin.core.analysis.PdbUniversalAnalyzer;
import ghidra.app.script.GhidraScript;

public class SetPdbFile extends GhidraScript {

	@Override
	protected void run() throws Exception {
		String[] args = getScriptArgs();
		if (args.length < 1) {
			throw new IllegalArgumentException("usage: SetPdbFile <chemin.pdb>");
		}
		File pdb = new File(args[0]);
		if (!pdb.isFile()) {
			throw new IllegalArgumentException("PDB introuvable : " + pdb);
		}
		PdbUniversalAnalyzer.setPdbFileOption(currentProgram, pdb);
		println("PDB force : " + pdb);
	}
}
