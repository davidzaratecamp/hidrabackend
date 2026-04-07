const getMesesController = async (req, res) => {
    try {
        const cedula = req.usuario.numero_documento;
        if (!cedula) {
            return res.status(400).json({
                ok: false,
                message: 'Tu usuario no tiene número de documento registrado. Contacta al administrador.'
            });
        }

        const response = await fetch(
            `${process.env.NOMINA_BASE_URL}/meses?cedula=${cedula}`,
            { headers: { 'X-Api-Key': process.env.API_KEY_NOMINA } }
        );

        const data = await response.json();
        return res.status(response.status).json(data);
    } catch (error) {
        return res.status(500).json({ ok: false, message: error.message });
    }
};

const getPdfController = async (req, res) => {
    try {
        const cedula = req.usuario.numero_documento;
        if (!cedula) {
            return res.status(400).json({
                ok: false,
                message: 'Tu usuario no tiene número de documento registrado.'
            });
        }

        const { year, month } = req.params;

        const response = await fetch(
            `${process.env.NOMINA_BASE_URL}/pdf/${year}/${month}?cedula=${cedula}`,
            { headers: { 'X-Api-Key': process.env.API_KEY_NOMINA } }
        );

        if (!response.ok) {
            const data = await response.json();
            return res.status(response.status).json({ ok: false, message: data.message });
        }

        const buffer = await response.arrayBuffer();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="desprendible_${month}_${year}.pdf"`);
        res.send(Buffer.from(buffer));
    } catch (error) {
        return res.status(500).json({ ok: false, message: error.message });
    }
};

module.exports = { getMesesController, getPdfController };
