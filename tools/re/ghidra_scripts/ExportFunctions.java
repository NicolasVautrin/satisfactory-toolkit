// Postscript headless : exporte toutes les fonctions (RVA, taille, nom qualifie, prototype) en TSV.
// LECTURE HUMAINE uniquement (chercher, croiser, citer) : les hooks Frida ne s'en servent JAMAIS,
// ils resolvent leurs adresses au runtime par nom exporte (une RVA de dump perime au prochain build).
// Usage : -postScript ExportFunctions.java <sortie.tsv>
//@category Satisfactory
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;

public class ExportFunctions extends GhidraScript {

	@Override
	protected void run() throws Exception {
		String[] args = getScriptArgs();
		if (args.length < 1) {
			throw new IllegalArgumentException("usage: ExportFunctions <sortie.tsv>");
		}
		File out = new File(args[0]);
		Address base = currentProgram.getImageBase();
		int count = 0;
		try (PrintWriter w = new PrintWriter(new BufferedWriter(
			new OutputStreamWriter(new FileOutputStream(out), "UTF-8")))) {
			w.println("rva\tsize\tname\tprototype");
			for (Function f : currentProgram.getFunctionManager().getFunctions(true)) {
				if (monitor.isCancelled()) {
					break;
				}
				long rva = f.getEntryPoint().subtract(base);
				w.printf("0x%x\t%d\t%s\t%s%n", rva, f.getBody().getNumAddresses(),
					f.getName(true), f.getPrototypeString(false, false));
				count++;
			}
		}
		println("fonctions exportees : " + count + " -> " + out);
	}
}
