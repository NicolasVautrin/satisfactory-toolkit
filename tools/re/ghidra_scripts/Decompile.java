// Script headless : decompile des fonctions par nom qualifie, vers un fichier texte.
// Usage : -postScript Decompile.java <sortie.c> "Classe::Methode" ["Classe::Autre" ...]
// Lancer avec -process <programme> -noanalysis -readOnly pour ne rien modifier au projet.
//@category Satisfactory
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.util.ArrayList;
import java.util.List;

import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Function;

public class Decompile extends GhidraScript {

	@Override
	protected void run() throws Exception {
		String[] args = getScriptArgs();
		if (args.length < 2) {
			throw new IllegalArgumentException("usage: Decompile <sortie.c> <Classe::Methode>...");
		}
		DecompInterface decomp = new DecompInterface();
		decomp.openProgram(currentProgram);
		try (PrintWriter w = new PrintWriter(new OutputStreamWriter(new FileOutputStream(new File(args[0])), "UTF-8"))) {
			for (int i = 1; i < args.length; i++) {
				List<Function> matches = new ArrayList<>();
				for (Function f : currentProgram.getFunctionManager().getFunctions(true)) {
					if (f.getName(true).equals(args[i])) {
						matches.add(f);
					}
				}
				if (matches.isEmpty()) {
					w.println("// " + args[i] + " : INTROUVABLE\n");
				}
				for (Function f : matches) {
					DecompileResults res = decomp.decompileFunction(f, 120, monitor);
					w.println("// ===== " + f.getName(true) + " @ " + f.getEntryPoint());
					w.println(res.decompileCompleted() ? res.getDecompiledFunction().getC() : "// echec : " + res.getErrorMessage());
				}
			}
		}
		finally {
			decomp.dispose();
		}
		println("decompilation ecrite : " + args[0]);
	}
}
